using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.ApplicationServices;
using DesignAutomationFramework;
using Autodesk.Revit.DB.Events;

namespace ADNPlugin.Revit.FileUpgrader
{
    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class FileUpgradeApp : IExternalDBApplication
    {
        // Store reference to our failure processor so we can unregister it later
        private static FileUpgradeFailureProcessor _failureProcessor;

        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            Console.WriteLine("==== FILE UPGRADER STARTUP ====");
            LogWithTimestamp("Application startup initiated");

            try
            {
                // CRITICAL: Register the failure processor BEFORE any documents are opened
                // This is the key difference - we need this registered before DA opens the document
                _failureProcessor = new FileUpgradeFailureProcessor();

                // Use the static method on Application class - this is the correct approach
                Autodesk.Revit.ApplicationServices.Application.RegisterFailuresProcessor(_failureProcessor);
                LogWithTimestamp("Global failure processor registered successfully");

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
                // Get the Revit version for logging
                Application rvtApp = e.DesignAutomationData.RevitApp;
                string versionInfo = $"Revit Version: {rvtApp.VersionNumber} Build: {rvtApp.VersionBuild}";
                LogWithTimestamp(versionInfo);

                // Process the document (it's already open at this point)
                e.Succeeded = ProcessDocument(e.DesignAutomationData);

                if (e.Succeeded)
                {
                    LogWithTimestamp("Document processing completed successfully");
                }
                else
                {
                    LogError("Document processing failed");
                }
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

                Document doc = data.RevitDoc;
                if (doc == null)
                {
                    LogError("Document is null - this should not happen");
                    return false;
                }

                // Log document information
                LogWithTimestamp($"Document Title: {doc.Title}");
                LogWithTimestamp($"Document Path: {doc.PathName}");
                LogWithTimestamp($"Is Modified: {doc.IsModified}");
                LogWithTimestamp($"Is Workshared: {doc.IsWorkshared}");
                LogWithTimestamp($"Is Detached: {doc.IsDetached}");

                // Check if document has been successfully opened without critical errors
                if (_failureProcessor.HasCriticalErrors)
                {
                    LogError("Document was opened with critical errors that could not be resolved");
                    LogWithTimestamp($"Total failures processed: {_failureProcessor.TotalFailuresProcessed}");
                    LogWithTimestamp($"Warnings deleted: {_failureProcessor.WarningsDeleted}");
                    LogWithTimestamp($"Errors resolved: {_failureProcessor.ErrorsResolved}");
                    LogWithTimestamp($"Elements deleted: {_failureProcessor.ElementsDeleted}");
                }

                // Save the upgraded file
                string outputPath = "revitupgrade.rvt";
                LogWithTimestamp($"Preparing to save upgraded file as: {outputPath}");

                ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(outputPath);

                SaveAsOptions saveOptions = new SaveAsOptions();
                saveOptions.OverwriteExistingFile = true;
                saveOptions.Compact = false; // Don't compact to save time
                saveOptions.MaximumBackups = 1; // Minimize backups for DA

                // Configure worksharing if needed
                if (doc.IsWorkshared)
                {
                    LogWithTimestamp("Document is workshared - configuring worksharing save options");
                    WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                    wsOptions.SaveAsCentral = true;
                    wsOptions.OpenWorksetsDefault = SimpleWorksetConfiguration.AllWorksets;
                    saveOptions.SetWorksharingOptions(wsOptions);
                }

                LogWithTimestamp("Saving upgraded file...");
                var saveStart = DateTime.Now;
                doc.SaveAs(modelPath, saveOptions);
                var saveTime = (DateTime.Now - saveStart).TotalSeconds;
                LogWithTimestamp($"File saved successfully in {saveTime:F2} seconds");

                // Log final statistics
                LogWithTimestamp("=== UPGRADE STATISTICS ===");
                LogWithTimestamp($"Total failures processed: {_failureProcessor.TotalFailuresProcessed}");
                LogWithTimestamp($"Warnings deleted: {_failureProcessor.WarningsDeleted}");
                LogWithTimestamp($"Errors resolved: {_failureProcessor.ErrorsResolved}");
                LogWithTimestamp($"Elements deleted: {_failureProcessor.ElementsDeleted}");
                LogWithTimestamp($"Dimension errors fixed: {_failureProcessor.DimensionErrorsFixed}");
                LogWithTimestamp($"Network connectivity errors fixed: {_failureProcessor.NetworkErrorsFixed}");
                LogWithTimestamp("========================");

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
                // Unregister the failure processor to clean up
                if (_failureProcessor != null)
                {
                    // Use the static method to unregister by passing null
                    Autodesk.Revit.ApplicationServices.Application.RegisterFailuresProcessor(null);
                    LogWithTimestamp("Failure processor unregistered");
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
    /// Custom failure processor that handles all failures during the entire DA session,
    /// including document opening failures which occur before any transaction context exists.
    /// </summary>
    public class FileUpgradeFailureProcessor : IFailuresProcessor
    {
        // Statistics for logging
        public int TotalFailuresProcessed { get; private set; } = 0;
        public int WarningsDeleted { get; private set; } = 0;
        public int ErrorsResolved { get; private set; } = 0;
        public int ElementsDeleted { get; private set; } = 0;
        public int DimensionErrorsFixed { get; private set; } = 0;
        public int NetworkErrorsFixed { get; private set; } = 0;
        public bool HasCriticalErrors { get; private set; } = false;

        // Known failure IDs that we handle specifically
        private readonly HashSet<Guid> _knownFailureGuids = new HashSet<Guid>
        {
            new Guid("8a9ff20d-fdc2-4f98-87e6-2aa8b71b0c83"), // Dimension references not parallel
            new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041"), // Family network connectivity
            new Guid("0d5f227d-a4fd-4bc2-b539-1a13cd9a9173")  // Line is too short
        };

        public FailureProcessingResult ProcessFailures(FailuresAccessor failuresAccessor)
        {
            IList<FailureMessageAccessor> failures = failuresAccessor.GetFailureMessages();

            if (failures.Count == 0)
            {
                return FailureProcessingResult.Continue;
            }

            TotalFailuresProcessed += failures.Count;
            LogWithTimestamp($"Processing {failures.Count} failures");

            // First pass: Delete all warnings
            var warnings = failures.Where(f => f.GetSeverity() == FailureSeverity.Warning).ToList();
            foreach (var warning in warnings)
            {
                try
                {
                    failuresAccessor.DeleteWarning(warning);
                    WarningsDeleted++;
                    LogWithTimestamp($"Deleted warning: {warning.GetDescriptionText()}");
                }
                catch (Exception ex)
                {
                    LogError($"Failed to delete warning: {warning.GetDescriptionText()}", ex);
                }
            }

            // Second pass: Handle errors
            var errors = failures.Where(f => f.GetSeverity() == FailureSeverity.Error).ToList();
            foreach (var error in errors)
            {
                HandleError(failuresAccessor, error);
            }

            // Check if any critical errors remain
            var remainingErrors = failuresAccessor.GetFailureMessages()
                .Where(f => f.GetSeverity() == FailureSeverity.Error)
                .ToList();

            if (remainingErrors.Count > 0)
            {
                HasCriticalErrors = true;
                LogError($"{remainingErrors.Count} errors could not be resolved");

                // Log details of unresolved errors
                foreach (var error in remainingErrors)
                {
                    LogError($"Unresolved error: {error.GetDescriptionText()}");
                }
            }

            return FailureProcessingResult.Continue;
        }

        private void HandleError(FailuresAccessor failuresAccessor, FailureMessageAccessor error)
        {
            string description = error.GetDescriptionText();
            FailureDefinitionId failureId = error.GetFailureDefinitionId();
            Guid failureGuid = failureId?.Guid ?? Guid.Empty;

            LogWithTimestamp($"Processing error: {description}");
            LogWithTimestamp($"Failure ID: {failureGuid}");

            // Handle specific known failures
            if (failureGuid == new Guid("8a9ff20d-fdc2-4f98-87e6-2aa8b71b0c83"))
            {
                // Dimension references not parallel
                LogWithTimestamp("Detected dimension reference error - attempting to fix");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    DimensionErrorsFixed++;
                    ErrorsResolved++;
                }
            }
            else if (failureGuid == new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041"))
            {
                // Family network connectivity
                LogWithTimestamp("Detected network connectivity error - attempting to fix");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    NetworkErrorsFixed++;
                    ErrorsResolved++;
                }
            }
            else if (failureGuid == new Guid("0d5f227d-a4fd-4bc2-b539-1a13cd9a9173"))
            {
                // Line is too short - usually safe to delete elements
                LogWithTimestamp("Detected 'line too short' error - will delete elements");
                if (TryDeleteFailingElements(failuresAccessor, error))
                {
                    ErrorsResolved++;
                }
            }
            else
            {
                // Generic error handling
                LogWithTimestamp("Unknown error type - attempting generic resolution");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    ErrorsResolved++;
                }
            }
        }

        private bool TryResolveOrDelete(FailuresAccessor failuresAccessor, FailureMessageAccessor error)
        {
            // First try to resolve using available resolutions
            if (error.HasResolutions())
            {
                try
                {
                    failuresAccessor.ResolveFailure(error);
                    LogWithTimestamp("Successfully resolved error using default resolution");
                    return true;
                }
                catch (Exception ex)
                {
                    LogError("Failed to resolve error", ex);
                }
            }

            // If resolution failed or unavailable, try to delete elements
            return TryDeleteFailingElements(failuresAccessor, error);
        }

        private bool TryDeleteFailingElements(FailuresAccessor failuresAccessor, FailureMessageAccessor error)
        {
            var failingElements = error.GetFailingElementIds();
            if (failingElements != null && failingElements.Count > 0)
            {
                try
                {
                    failuresAccessor.DeleteElements(failingElements.ToList());
                    ElementsDeleted += failingElements.Count;
                    LogWithTimestamp($"Deleted {failingElements.Count} failing elements");
                    return true;
                }
                catch (Exception ex)
                {
                    LogError($"Failed to delete {failingElements.Count} elements", ex);
                }
            }
            return false;
        }

        public void Dismiss(Document document)
        {
            // This method is called when the failure processing dialog would normally be dismissed
            // We don't need to do anything here for DA
            LogWithTimestamp("Failure processor dismissed");
        }

        private static void LogWithTimestamp(string message)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [FAILURE_PROCESSOR] {message}");
        }

        private static void LogError(string message, Exception ex = null)
        {
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [FAILURE_PROCESSOR] ERROR: {message}");
            if (ex != null)
            {
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] [FAILURE_PROCESSOR] Exception: {ex.Message}");
            }
        }
    }
}