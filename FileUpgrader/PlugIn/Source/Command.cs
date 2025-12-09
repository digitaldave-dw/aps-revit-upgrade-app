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
        private static FileUpgradeFailureProcessor _failureProcessor;

        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            Console.WriteLine("==== FILE UPGRADER STARTUP ====");
            LogWithTimestamp("Application startup initiated");

            try
            {
                _failureProcessor = new FileUpgradeFailureProcessor();

                Autodesk.Revit.ApplicationServices.Application.RegisterFailuresProcessor(_failureProcessor);
                LogWithTimestamp("Global failure processor registered successfully");

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
                string versionInfo = $"Revit Version: {rvtApp.VersionNumber} Build: {rvtApp.VersionBuild}";
                LogWithTimestamp(versionInfo);

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

                LogWithTimestamp($"Document Title: {doc.Title}");
                LogWithTimestamp($"Document Path: {doc.PathName}");
                LogWithTimestamp($"Is Modified: {doc.IsModified}");
                LogWithTimestamp($"Is Workshared: {doc.IsWorkshared}");
                LogWithTimestamp($"Is Detached: {doc.IsDetached}");

                if (_failureProcessor.HasCriticalErrors)
                {
                    LogError("Document was opened with critical errors that could not be resolved");
                    LogWithTimestamp($"Total failures processed: {_failureProcessor.TotalFailuresProcessed}");
                    LogWithTimestamp($"Warnings deleted: {_failureProcessor.WarningsDeleted}");
                    LogWithTimestamp($"Errors resolved: {_failureProcessor.ErrorsResolved}");
                    LogWithTimestamp($"Elements deleted: {_failureProcessor.ElementsDeleted}");
                }

                string outputPath = "revitupgrade.rvt";
                LogWithTimestamp($"Preparing to save upgraded file as: {outputPath}");

                ModelPath modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(outputPath);

                SaveAsOptions saveOptions = new SaveAsOptions();
                saveOptions.OverwriteExistingFile = true;
                saveOptions.Compact = false; 
                saveOptions.MaximumBackups = 1; 

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
                if (_failureProcessor != null)
                {
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
        public int TotalFailuresProcessed { get; private set; } = 0;
        public int WarningsDeleted { get; private set; } = 0;
        public int ErrorsResolved { get; private set; } = 0;
        public int ElementsDeleted { get; private set; } = 0;
        public int DimensionErrorsFixed { get; private set; } = 0;
        public int NetworkErrorsFixed { get; private set; } = 0;
        public bool HasCriticalErrors { get; private set; } = false;

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

            var errors = failures.Where(f => f.GetSeverity() == FailureSeverity.Error).ToList();
            foreach (var error in errors)
            {
                HandleError(failuresAccessor, error);
            }

            var remainingErrors = failuresAccessor.GetFailureMessages()
                .Where(f => f.GetSeverity() == FailureSeverity.Error)
                .ToList();

            if (remainingErrors.Count > 0)
            {
                HasCriticalErrors = true;
                LogError($"{remainingErrors.Count} errors could not be resolved");

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

            if (failureGuid == new Guid("8a9ff20d-fdc2-4f98-87e6-2aa8b71b0c83"))
            {
                LogWithTimestamp("Detected dimension reference error - attempting to fix");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    DimensionErrorsFixed++;
                    ErrorsResolved++;
                }
            }
            else if (failureGuid == new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041"))
            {
                LogWithTimestamp("Detected network connectivity error - attempting to fix");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    NetworkErrorsFixed++;
                    ErrorsResolved++;
                }
            }
            else if (failureGuid == new Guid("0d5f227d-a4fd-4bc2-b539-1a13cd9a9173"))
            {
                LogWithTimestamp("Detected 'line too short' error - will delete elements");
                if (TryDeleteFailingElements(failuresAccessor, error))
                {
                    ErrorsResolved++;
                }
            }
            else
            {
                LogWithTimestamp("Unknown error type - attempting generic resolution");
                if (TryResolveOrDelete(failuresAccessor, error))
                {
                    ErrorsResolved++;
                }
            }
        }

        private bool TryResolveOrDelete(FailuresAccessor failuresAccessor, FailureMessageAccessor error)
        {
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