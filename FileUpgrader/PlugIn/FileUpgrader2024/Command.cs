using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.ApplicationServices;
using DesignAutomationFramework;
using Autodesk.Revit.DB.Events;

namespace ADNPlugin.Revit.FileUpgrader2024
{
    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class FileUpgradeApp : IExternalDBApplication
    {
        // Store reference to our failure processor
        private static DocumentUpgradeFailureProcessor _failureProcessor;

        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            Console.WriteLine("==== FILE UPGRADER STARTUP ====");
            LogWithTimestamp("Application startup initiated");

            try
            {
                // CRITICAL: Register the failure processor immediately on startup
                // This ensures it's active BEFORE Design Automation tries to open the document
                _failureProcessor = new DocumentUpgradeFailureProcessor();
                Autodesk.Revit.ApplicationServices.Application.RegisterFailuresProcessor(_failureProcessor);
                LogWithTimestamp("Document upgrade failure processor registered successfully");

                // Subscribe to DesignAutomationReadyEvent
                DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomationReadyEvent;
                LogWithTimestamp("Subscribed to DesignAutomationReadyEvent");

                return ExternalDBApplicationResult.Succeeded;
            }
            catch (Exception ex)
            {
                LogError("Failed during startup", ex);
                return ExternalDBApplicationResult.Failed;
            }
        }

        public void HandleDesignAutomationReadyEvent(object sender, DesignAutomationReadyEventArgs e)
        {
            LogWithTimestamp("DesignAutomationReadyEvent fired");

            try
            {
                Application rvtApp = e.DesignAutomationData.RevitApp;
                Document doc = e.DesignAutomationData.RevitDoc;

                // Log current state
                string versionInfo = $"Revit Version: {rvtApp.VersionNumber} Build: {rvtApp.VersionBuild}";
                LogWithTimestamp(versionInfo);

                // Log failure processor statistics to see what happened during document opening
                LogWithTimestamp("=== DOCUMENT OPENING STATISTICS ===");
                LogWithTimestamp($"Total failures processed: {_failureProcessor.TotalFailuresProcessed}");
                LogWithTimestamp($"Warnings deleted: {_failureProcessor.WarningsDeleted}");
                LogWithTimestamp($"Errors resolved: {_failureProcessor.ErrorsResolved}");
                LogWithTimestamp($"Elements deleted: {_failureProcessor.ElementsDeleted}");
                LogWithTimestamp($"Has unresolved errors: {_failureProcessor.HasUnresolvedErrors}");
                LogWithTimestamp("===================================");

                if (doc == null)
                {
                    LogError("Document is null - document opening failed despite failure handling");
                    e.Succeeded = false;
                    return;
                }

                LogWithTimestamp("Document opened successfully");
                // Process and save the document
                e.Succeeded = ProcessDocument(e.DesignAutomationData);
            }
            catch (Exception ex)
            {
                LogError("Exception in DesignAutomationReadyEvent handler", ex);
                e.Succeeded = false;
            }
        }

        private bool ProcessDocument(DesignAutomationData data)
        {
            try
            {
                LogWithTimestamp("Starting document processing");

                Application rvtApp = data.RevitApp;
                Document doc = data.RevitDoc;
                string inputFilePath = data.FilePath;

                // If document failed to open (e.g., corruption), try opening with Audit
                if (doc == null)
                {
                    LogWithTimestamp("Document is null - attempting to open with Audit option for recovery");

                    if (string.IsNullOrEmpty(inputFilePath))
                    {
                        LogError("No file path available for audit recovery");
                        return false;
                    }

                    try
                    {
                        LogWithTimestamp($"Attempting audit recovery for: {inputFilePath}");

                        ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(inputFilePath);
                        OpenOptions openOptions = new OpenOptions();
                        openOptions.Audit = true;  // Enable audit to repair corruption
                        openOptions.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets;

                        // Set up workset configuration
                        WorksetConfiguration worksetConfig = new WorksetConfiguration(WorksetConfigurationOption.OpenAllWorksets);
                        openOptions.SetOpenWorksetsConfiguration(worksetConfig);

                        LogWithTimestamp("Opening file with Audit=true...");
                        doc = rvtApp.OpenDocumentFile(modelPath, openOptions);

                        if (doc == null)
                        {
                            LogError("Audit recovery failed - document still null");
                            return false;
                        }

                        LogWithTimestamp("Audit recovery successful - document opened");
                    }
                    catch (Exception auditEx)
                    {
                        LogError("Audit recovery failed with exception", auditEx);
                        return false;
                    }
                }

                // Log document information
                LogWithTimestamp($"Document Title: {doc.Title}");
                LogWithTimestamp($"Document Path: {doc.PathName}");
                LogWithTimestamp($"Is Modified: {doc.IsModified}");
                LogWithTimestamp($"Is Workshared: {doc.IsWorkshared}");
                LogWithTimestamp($"Is Detached: {doc.IsDetached}");

                // Note: Design Automation automatically opens workshared files as detached
                // (notice the _detached suffix in the document title)
                // We just need to save with proper worksharing options

                // Save the upgraded file
                string outputPath = "revitupgrade.rvt";
                LogWithTimestamp($"Preparing to save upgraded file as: {outputPath}");

                ModelPath outputModelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(outputPath);

                SaveAsOptions saveOptions = new SaveAsOptions();
                saveOptions.OverwriteExistingFile = true;
                saveOptions.Compact = true; // Compact can help fix issues
                saveOptions.MaximumBackups = 1;

                // CRITICAL: For workshared documents (including detached ones),
                // you MUST use WorksharingSaveAsOptions with SaveAsCentral = true
                // This is required by Revit API for any workshared document
                if (doc.IsWorkshared)
                {
                    LogWithTimestamp("Document is workshared - configuring worksharing save options with SaveAsCentral=true");
                    WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                    wsOptions.SaveAsCentral = true;  // REQUIRED for workshared/detached documents
                    wsOptions.OpenWorksetsDefault = SimpleWorksetConfiguration.AllWorksets;
                    saveOptions.SetWorksharingOptions(wsOptions);
                }

                LogWithTimestamp("Saving upgraded file...");
                var saveStart = DateTime.Now;
                doc.SaveAs(outputModelPath, saveOptions);
                var saveTime = (DateTime.Now - saveStart).TotalSeconds;
                LogWithTimestamp($"File saved successfully in {saveTime:F2} seconds");

                // Log final statistics
                LogWithTimestamp("=== UPGRADE COMPLETE - FINAL STATISTICS ===");
                LogWithTimestamp($"Total failures processed: {_failureProcessor.TotalFailuresProcessed}");
                LogWithTimestamp($"Warnings deleted: {_failureProcessor.WarningsDeleted}");
                LogWithTimestamp($"Errors resolved: {_failureProcessor.ErrorsResolved}");
                LogWithTimestamp($"Elements deleted: {_failureProcessor.ElementsDeleted}");
                LogWithTimestamp("==========================================");

                return true;
            }
            catch (Exception ex)
            {
                LogError("Exception during document processing", ex);
                return false;
            }
        }

        public ExternalDBApplicationResult OnShutdown(ControlledApplication application)
        {
            LogWithTimestamp("==== FILE UPGRADER SHUTDOWN ====");

            try
            {
                // Only unregister if we have a processor
                if (_failureProcessor != null)
                {
                    Application.RegisterFailuresProcessor(null);
                    LogWithTimestamp("Failure processor unregistered");
                    _failureProcessor = null;
                }
            }
            catch (Exception ex)
            {
                LogError("Error during shutdown", ex);
            }

            return ExternalDBApplicationResult.Succeeded;
        }

        // Logging helper methods
        private static void LogWithTimestamp(string message)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] {message}");
        }

        private static void LogError(string message, Exception ex = null)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] ERROR: {message}");
            if (ex != null)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Exception Type: {ex.GetType().Name}");
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Exception Message: {ex.Message}");
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Stack Trace: {ex.StackTrace}");
            }
        }
    }

    /// <summary>
    /// Custom failure processor that handles MEP-specific failures during file upgrades
    /// </summary>
    public class FileUpgradeFailureProcessor : IFailuresProcessor
    {
        // Statistics for logging
        public int TotalFailuresProcessed { get; private set; } = 0;
        public int WarningsDeleted { get; private set; } = 0;
        public int ErrorsResolved { get; private set; } = 0;
        public int ElementsDeleted { get; private set; } = 0;

        // Track specific MEP failure types
        private readonly Dictionary<Guid, string> _mepFailures = new Dictionary<Guid, string>
        {
            { new Guid("69f669cb-8551-49cb-b7d2-8213056b9578"), "Tap must be attached to duct" },
            { new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041"), "Family network connectivity" },
            { new Guid("8a9ff20d-fdc2-4f98-87e6-2aa8b71b0c83"), "Dimension references not parallel" },
            { new Guid("0d5f227d-a4fd-4bc2-b539-1a13cd9a9173"), "Line is too short" }
        };

        public FailureProcessingResult ProcessFailures(FailuresAccessor failuresAccessor)
        {
            IList<FailureMessageAccessor> failures = failuresAccessor.GetFailureMessages();

            LogWithTimestamp($"[PROCESSOR] Processing {failures.Count} failures");
            TotalFailuresProcessed += failures.Count;

            // First, handle all warnings
            foreach (var failure in failures.ToList())
            {
                if (failure.GetSeverity() == FailureSeverity.Warning)
                {
                    try
                    {
                        failuresAccessor.DeleteWarning(failure);
                        WarningsDeleted++;
                        LogWithTimestamp($"[PROCESSOR] Deleted warning: {failure.GetDescriptionText()}");
                    }
                    catch (Exception ex)
                    {
                        LogError("[PROCESSOR] Failed to delete warning", ex);
                    }
                }
            }

            // Now handle errors
            var errors = failuresAccessor.GetFailureMessages()
                .Where(f => f.GetSeverity() == FailureSeverity.Error)
                .ToList();

            foreach (var error in errors)
            {
                HandleError(failuresAccessor, error);
            }

            // Always return Continue to let the process proceed
            return FailureProcessingResult.Continue;
        }

        private void HandleError(FailuresAccessor failuresAccessor, FailureMessageAccessor error)
        {
            string description = error.GetDescriptionText();
            FailureDefinitionId failureId = error.GetFailureDefinitionId();
            Guid failureGuid = failureId?.Guid ?? Guid.Empty;

            LogWithTimestamp($"[PROCESSOR] Handling error: {description}");
            LogWithTimestamp($"[PROCESSOR] Failure GUID: {failureGuid}");

            // Check if this is a known MEP failure
            if (_mepFailures.ContainsKey(failureGuid))
            {
                LogWithTimestamp($"[PROCESSOR] Recognized MEP failure: {_mepFailures[failureGuid]}");
            }

            // For MEP tap attachment errors, we should delete the elements
            if (failureGuid == new Guid("69f669cb-8551-49cb-b7d2-8213056b9578"))
            {
                // This is the "Tap must be attached to duct" error
                LogWithTimestamp("[PROCESSOR] Attempting to resolve tap attachment error");

                // First check if there's a delete resolution available
                if (error.HasResolutionOfType(FailureResolutionType.DeleteElements))
                {
                    try
                    {
                        error.SetCurrentResolutionType(FailureResolutionType.DeleteElements);
                        failuresAccessor.ResolveFailure(error);
                        ErrorsResolved++;
                        LogWithTimestamp("[PROCESSOR] Resolved by setting delete resolution");
                        return;
                    }
                    catch (Exception ex)
                    {
                        LogError("[PROCESSOR] Failed to set delete resolution", ex);
                    }
                }

                // If that didn't work, try to delete the elements directly
                var failingElements = error.GetFailingElementIds();
                if (failingElements != null && failingElements.Count > 0)
                {
                    try
                    {
                        failuresAccessor.DeleteElements(failingElements.ToList());
                        ElementsDeleted += failingElements.Count;
                        ErrorsResolved++;
                        LogWithTimestamp($"[PROCESSOR] Deleted {failingElements.Count} failing tap elements");
                        return;
                    }
                    catch (Exception ex)
                    {
                        LogError("[PROCESSOR] Failed to delete tap elements", ex);
                    }
                }
            }

            // For other errors, try generic resolution
            if (error.HasResolutions())
            {
                try
                {
                    // Try the default resolution
                    failuresAccessor.ResolveFailure(error);
                    ErrorsResolved++;
                    LogWithTimestamp("[PROCESSOR] Resolved using default resolution");
                }
                catch (Exception ex)
                {
                    LogError("[PROCESSOR] Failed to resolve error", ex);

                    // As a last resort, try to delete elements
                    var elements = error.GetFailingElementIds();
                    if (elements != null && elements.Count > 0)
                    {
                        try
                        {
                            failuresAccessor.DeleteElements(elements.ToList());
                            ElementsDeleted += elements.Count;
                            LogWithTimestamp($"[PROCESSOR] Deleted {elements.Count} elements as last resort");
                        }
                        catch (Exception deleteEx)
                        {
                            LogError("[PROCESSOR] Failed to delete elements", deleteEx);
                        }
                    }
                }
            }
        }

        public void Dismiss(Document document)
        {
            LogWithTimestamp("[PROCESSOR] Failure processor dismissed");
        }

        private static void LogWithTimestamp(string message)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] {message}");
        }

        private static void LogError(string message, Exception ex = null)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] ERROR: {message}");
            if (ex != null)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] Exception: {ex.Message}");
            }
        }
    }
}