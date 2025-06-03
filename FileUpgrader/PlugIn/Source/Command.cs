using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.ApplicationServices;
using DesignAutomationFramework;

namespace ADNPlugin.Revit.FileUpgrader
{
    internal class RuntimeValue
    {
        public static bool RunOnCloud { get; } = true;
    }

    /// <summary>
    /// Custom failure preprocessor to handle errors during file operations
    /// This runs BEFORE the main failure processor and can suppress or resolve failures
    /// </summary>
    public class FileUpgradeFailuresPreprocessor : IFailuresPreprocessor
    {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor)
        {
            IList<FailureMessageAccessor> failureMessages = failuresAccessor.GetFailureMessages();

            // If no failures, continue normally
            if (failureMessages.Count == 0)
            {
                return FailureProcessingResult.Continue;
            }

            Console.WriteLine($"Preprocessing {failureMessages.Count} failures...");

            foreach (FailureMessageAccessor failure in failureMessages)
            {
                try
                {
                    FailureSeverity severity = failure.GetSeverity();
                    string description = failure.GetDescriptionText();
                    FailureDefinitionId failureId = failure.GetFailureDefinitionId();

                    Console.WriteLine($"Failure: {severity} - {description}");
                    if (failureId != null)
                    {
                        Console.WriteLine($"  Failure ID: {failureId.Guid}");
                    }

                    // For warnings, we can delete them
                    if (severity == FailureSeverity.Warning)
                    {
                        failuresAccessor.DeleteWarning(failure);
                        Console.WriteLine("  -> Deleted warning");
                    }
                    // For errors, try to resolve them
                    else if (severity == FailureSeverity.Error)
                    {
                        // Check if Revit has a suggested resolution
                        if (failure.HasResolutions())
                        {
                            failuresAccessor.ResolveFailure(failure);
                            Console.WriteLine("  -> Applied default resolution");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"  -> Error processing failure: {ex.Message}");
                }
            }

            // Always return Continue to let the main processor handle any remaining issues
            return FailureProcessingResult.Continue;
        }
    }

    /// <summary>
    /// Main failure processor for handling errors that the preprocessor couldn't resolve
    /// This completely replaces Revit's failure UI - essential for Design Automation
    /// </summary>
    public class FileUpgradeFailureProcessor : IFailuresProcessor
    {
        private int processingAttempts = 0;
        private const int MAX_PROCESSING_ATTEMPTS = 5;

        public FailureProcessingResult ProcessFailures(FailuresAccessor failuresAccessor)
        {
            IList<FailureMessageAccessor> failureMessages = failuresAccessor.GetFailureMessages();

            // If no failures remain, we're done
            if (failureMessages.Count == 0)
            {
                processingAttempts = 0;
                return FailureProcessingResult.Continue;
            }

            // Check for infinite loop
            processingAttempts++;
            if (processingAttempts > MAX_PROCESSING_ATTEMPTS)
            {
                Console.WriteLine($"ERROR: Exceeded maximum processing attempts ({MAX_PROCESSING_ATTEMPTS})");
                processingAttempts = 0;
                return FailureProcessingResult.ProceedWithRollBack;
            }

            Console.WriteLine($"Processing {failureMessages.Count} remaining failures (Attempt {processingAttempts})...");

            bool hasUnresolvedErrors = false;
            bool madeChanges = false;

            foreach (FailureMessageAccessor failure in failureMessages)
            {
                try
                {
                    FailureSeverity severity = failure.GetSeverity();
                    string description = failure.GetDescriptionText();

                    Console.WriteLine($"Failure: {severity} - {description}");

                    if (severity == FailureSeverity.Error)
                    {
                        bool resolved = false;

                        // Try to resolve with Revit's suggestion
                        if (failure.HasResolutions())
                        {
                            try
                            {
                                failuresAccessor.ResolveFailure(failure);
                                Console.WriteLine("  -> Resolved using default resolution");
                                resolved = true;
                                madeChanges = true;
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"  -> Failed to apply resolution: {ex.Message}");
                            }
                        }

                        // If that didn't work, try to delete the problematic elements
                        if (!resolved)
                        {
                            ICollection<ElementId> failingElementIds = failure.GetFailingElementIds();
                            if (failingElementIds != null && failingElementIds.Count > 0)
                            {
                                try
                                {
                                    // Convert ICollection to IList as required by the API
                                    IList<ElementId> elementList = failingElementIds.ToList();
                                    failuresAccessor.DeleteElements(elementList);
                                    Console.WriteLine($"  -> Deleted {elementList.Count} failing elements");
                                    resolved = true;
                                    madeChanges = true;
                                }
                                catch (Exception ex)
                                {
                                    Console.WriteLine($"  -> Failed to delete elements: {ex.Message}");
                                }
                            }
                        }

                        // If still not resolved, we have a problem
                        if (!resolved)
                        {
                            Console.WriteLine("  -> ERROR: Could not resolve failure");
                            hasUnresolvedErrors = true;
                        }
                    }
                    else if (severity == FailureSeverity.Warning)
                    {
                        // Delete any remaining warnings
                        try
                        {
                            failuresAccessor.DeleteWarning(failure);
                            Console.WriteLine("  -> Deleted warning");
                            madeChanges = true;
                        }
                        catch (Exception ex)
                        {
                            Console.WriteLine($"  -> Could not delete warning: {ex.Message}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Unexpected error processing failure: {ex.Message}");
                    hasUnresolvedErrors = true;
                }
            }

            // Determine what to do next
            if (hasUnresolvedErrors)
            {
                Console.WriteLine("Unresolved errors remain. Rolling back transaction.");
                processingAttempts = 0;
                return FailureProcessingResult.ProceedWithRollBack;
            }
            else if (madeChanges)
            {
                Console.WriteLine("Made changes. Requesting re-check.");
                return FailureProcessingResult.ProceedWithCommit;
            }
            else
            {
                Console.WriteLine("No changes made. Continuing.");
                return FailureProcessingResult.Continue;
            }
        }

        public void Dismiss(Document document)
        {
            Console.WriteLine($"Dismiss called for document: {document?.Title ?? "null"}");
            processingAttempts = 0;
        }
    }

    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class FileUpgradeApp : IExternalDBApplication
    {
        // Store a reference to our failure processor so we can manage it properly
        private static FileUpgradeFailureProcessor globalFailureProcessor = null;

        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            if (RuntimeValue.RunOnCloud)
            {
                DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomationReadyEvent;
            }
            else
            {
                application.ApplicationInitialized += HandleApplicationInitializedEvent;
            }

            // Note: We CANNOT register a global failure processor here because we don't have
            // access to the Application object yet, only ControlledApplication.
            // We'll register it when we get the Application object later.
            Console.WriteLine("File upgrade app initialized");

            return ExternalDBApplicationResult.Succeeded;
        }

        public void HandleApplicationInitializedEvent(object sender, Autodesk.Revit.DB.Events.ApplicationInitializedEventArgs e)
        {
            Application app = sender as Application;

            // NOW we can register our global failure processor
            RegisterGlobalFailureProcessor(app);

            String filePath = Directory.GetCurrentDirectory() + @"\Change to your local legacy RFA file for local test";
            DesignAutomationData data = new DesignAutomationData(app, filePath);
            UpgradeFile(data);
        }

        public void HandleDesignAutomationReadyEvent(object sender, DesignAutomationReadyEventArgs e)
        {
            // In Design Automation, register the failure processor with the application
            if (e.DesignAutomationData?.RevitApp != null)
            {
                RegisterGlobalFailureProcessor(e.DesignAutomationData.RevitApp);
            }

            e.Succeeded = true;
            UpgradeFile(e.DesignAutomationData);
        }

        /// <summary>
        /// Register our global failure processor with the Revit application
        /// This replaces Revit's default failure UI with our automated handler
        /// </summary>
        private void RegisterGlobalFailureProcessor(Application app)
        {
            try
            {
                // Create our failure processor if we haven't already
                if (globalFailureProcessor == null)
                {
                    globalFailureProcessor = new FileUpgradeFailureProcessor();
                }

                // Register it globally - this affects ALL transactions in the session
                Application.RegisterFailuresProcessor(globalFailureProcessor);
                Console.WriteLine("Registered global failure processor successfully");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"WARNING: Could not register global failure processor: {ex.Message}");
                // Continue anyway - individual transactions can still use preprocessors
            }
        }

        protected void UpgradeFile(DesignAutomationData data)
        {
            Document doc = null;

            try
            {
                Console.WriteLine("==== STARTING FILE UPGRADE PROCESS ====");

                if (data == null)
                    throw new ArgumentNullException(nameof(data));

                Application rvtApp = data.RevitApp;
                if (rvtApp == null)
                    throw new InvalidDataException(nameof(rvtApp));

                string modelPath = data.FilePath;
                Console.WriteLine($"Processing file: {modelPath}");

                if (String.IsNullOrWhiteSpace(modelPath))
                    throw new InvalidDataException(nameof(modelPath));

                doc = data.RevitDoc;

                // Check if document opened successfully
                if (doc == null)
                {
                    Console.WriteLine("Document failed to open through DesignAutomationData");
                    Console.WriteLine("This typically means the file has errors that prevented opening");

                    // Try to open with audit mode
                    Console.WriteLine("Attempting to open with audit mode enabled...");

                    OpenOptions openOptions = new OpenOptions();
                    openOptions.Audit = true;

                    // For workshared files, detach and preserve worksets
                    BasicFileInfo fileInfo = BasicFileInfo.Extract(modelPath);
                    if (fileInfo.IsWorkshared)
                    {
                        Console.WriteLine("File is workshared - setting detach options");
                        openOptions.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets;

                        // Open all worksets
                        WorksetConfiguration worksetConfig = new WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets);
                        openOptions.SetOpenWorksetsConfiguration(worksetConfig);
                    }

                    // Convert string path to ModelPath
                    ModelPath docPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(modelPath);

                    try
                    {
                        doc = rvtApp.OpenDocumentFile(docPath, openOptions);
                        Console.WriteLine("Successfully opened document with audit mode");
                    }
                    catch (Exception openEx)
                    {
                        Console.WriteLine($"Failed to open even with audit: {openEx.Message}");
                        throw new InvalidOperationException("Could not open document even with audit mode", openEx);
                    }
                }

                // Log document information
                Console.WriteLine($"Document opened successfully");
                Console.WriteLine($"Document Title: {doc.Title}");
                Console.WriteLine($"Document Path: {doc.PathName}");
                Console.WriteLine($"Is Workshared: {doc.IsWorkshared}");
                Console.WriteLine($"Revit Version: {doc.Application.VersionName}");

                // Check if document was modified during opening (indicates fixes were applied)
                if (doc.IsModified)
                {
                    Console.WriteLine("Document was modified during opening (errors were fixed)");
                }

                // Determine output file path
                string pathName = doc.PathName;
                string[] pathParts = pathName.Split('\\');
                string[] nameParts = pathParts[pathParts.Length - 1].Split('.');
                string extension = nameParts[nameParts.Length - 1];
                string outputFileName = "revitupgrade." + extension;
                ModelPath outputPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(outputFileName);
                Console.WriteLine($"Output path: {outputFileName}");

                // Save the upgraded file
                SaveUpgradedFile(doc, outputPath);

                Console.WriteLine("==== FILE UPGRADE PROCESS COMPLETED ====");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"==== CRITICAL ERROR IN UPGRADE PROCESS: {ex.GetType().Name} ====");
                Console.WriteLine($"Message: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");

                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                    Console.WriteLine($"Inner stack trace: {ex.InnerException.StackTrace}");
                }

                throw;
            }
            finally
            {
                // Clean up - close document if it's open and we're not in DA
                if (!RuntimeValue.RunOnCloud && doc != null && doc.IsValidObject)
                {
                    try
                    {
                        doc.Close(false);
                    }
                    catch { }
                }
            }
        }

        private void SaveUpgradedFile(Document doc, ModelPath outputPath)
        {
            Console.WriteLine("Preparing to save upgraded file...");

            // Create save options
            SaveAsOptions saveOpts = new SaveAsOptions();
            saveOpts.OverwriteExistingFile = true;
            saveOpts.Compact = false; // Don't compact to preserve structure and speed up save

            // Set preview view if needed
            try
            {
                if (doc.GetDocumentPreviewSettings().PreviewViewId.Equals(ElementId.InvalidElementId))
                {
                    Console.WriteLine("No preview view set, looking for 3D view...");

                    View view = new FilteredElementCollector(doc)
                        .OfClass(typeof(View))
                        .Cast<View>()
                        .Where(vw => vw.ViewType == ViewType.ThreeD && !vw.IsTemplate)
                        .FirstOrDefault();

                    if (view != null)
                    {
                        Console.WriteLine($"Setting preview view to: {view.Name}");
                        saveOpts.PreviewViewId = view.Id;
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error setting preview view: {ex.Message}");
                // Non-critical, continue without preview
            }

            // Configure worksharing options if needed
            if (doc.IsWorkshared)
            {
                Console.WriteLine("Configuring worksharing save options...");

                try
                {
                    WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                    wsOptions.SaveAsCentral = true;
                    wsOptions.OpenWorksetsDefault = SimpleWorksetConfiguration.AllWorksets;

                    saveOpts.SetWorksharingOptions(wsOptions);
                    Console.WriteLine("Worksharing options configured");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error setting worksharing options: {ex.Message}");
                    // Try to continue without special worksharing options
                }
            }

            // Perform the save with failure handling
            try
            {
                // Use a transaction to ensure failure handling is active
                // This gives us an extra layer of protection during save
                using (Transaction saveTransaction = new Transaction(doc, "Save Upgraded File"))
                {
                    // Set up failure handling for the save operation
                    // This preprocessor will handle any failures that occur during this specific transaction
                    FailureHandlingOptions failureOptions = saveTransaction.GetFailureHandlingOptions();
                    failureOptions.SetFailuresPreprocessor(new FileUpgradeFailuresPreprocessor());
                    failureOptions.SetClearAfterRollback(true);
                    saveTransaction.SetFailureHandlingOptions(failureOptions);

                    // We don't actually need to make changes, just ensure the transaction is active
                    saveTransaction.Start();
                    saveTransaction.Commit();
                }

                // Now save the document
                Console.WriteLine("Saving document...");
                doc.SaveAs(outputPath, saveOpts);
                Console.WriteLine("Document saved successfully!");
            }
            catch (Exception saveEx)
            {
                Console.WriteLine($"Primary save failed: {saveEx.Message}");

                // Try a simpler save without the transaction
                Console.WriteLine("Attempting simplified save...");
                try
                {
                    SaveAsOptions simpleSaveOpts = new SaveAsOptions();
                    simpleSaveOpts.OverwriteExistingFile = true;

                    doc.SaveAs(outputPath, simpleSaveOpts);
                    Console.WriteLine("Simplified save succeeded!");
                }
                catch (Exception fallbackEx)
                {
                    Console.WriteLine($"All save attempts failed: {fallbackEx.Message}");
                    throw new InvalidOperationException("Could not save the upgraded file", fallbackEx);
                }
            }
        }

        public ExternalDBApplicationResult OnShutdown(ControlledApplication application)
        {
            // Clean up our global failure processor
            if (globalFailureProcessor != null)
            {
                // Note: We can't unregister here because we don't have access to Application
                // But it will be cleaned up when Revit shuts down
                globalFailureProcessor = null;
            }

            return ExternalDBApplicationResult.Succeeded;
        }
    }
}