using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace FileUpgrader2025
{
    /// <summary>
    /// A failure processor specifically designed for Design Automation document upgrades.
    /// This processor ensures that all errors are resolved so document opening can succeed.
    /// </summary>
    public class DocumentUpgradeFailureProcessor : IFailuresProcessor
    {
        // Track statistics for reporting
        public int TotalFailuresProcessed { get; private set; } = 0;
        public int WarningsDeleted { get; private set; } = 0;
        public int ErrorsResolved { get; private set; } = 0;
        public int ElementsDeleted { get; private set; } = 0;
        public bool HasUnresolvedErrors { get; private set; } = false;

        // Known MEP failure GUIDs we encounter during upgrades
        private readonly Dictionary<Guid, string> _knownFailures = new Dictionary<Guid, string>
        {
            { new Guid("69f669cb-8551-49cb-b7d2-8213056b9578"), "Tap must be attached to duct" },
            { new Guid("dd0a16ea-9d2c-467d-b02c-5d86474a5041"), "Family network connectivity" },
            { new Guid("8a9ff20d-fdc2-4f98-87e6-2aa8b71b0c83"), "Dimension references not parallel" },
            { new Guid("0d5f227d-a4fd-4bc2-b539-1a13cd9a9173"), "Line is too short" }
        };

        public FailureProcessingResult ProcessFailures(FailuresAccessor failuresAccessor)
        {
            // Get all current failures
            IList<FailureMessageAccessor> failures = failuresAccessor.GetFailureMessages();

            if (failures.Count == 0)
            {
                // No failures to process - safe to continue
                return FailureProcessingResult.Continue;
            }

            LogWithTimestamp($"[PROCESSOR] Processing {failures.Count} failures");
            TotalFailuresProcessed += failures.Count;

            // First pass: Delete all warnings
            // According to the documentation, warnings don't prevent transaction commit
            int warningsFound = 0;
            foreach (var failure in failures)
            {
                if (failure.GetSeverity() == FailureSeverity.Warning)
                {
                    warningsFound++;
                    try
                    {
                        failuresAccessor.DeleteWarning(failure);
                        WarningsDeleted++;
                        LogWithTimestamp($"[PROCESSOR] Deleted warning: {failure.GetDescriptionText()}");
                    }
                    catch (Exception ex)
                    {
                        LogError($"[PROCESSOR] Failed to delete warning: {failure.GetDescriptionText()}", ex);
                    }
                }
            }

            // Get remaining failures (should only be errors now)
            failures = failuresAccessor.GetFailureMessages();

            // Second pass: Handle all errors
            // CRITICAL: We MUST resolve all errors, or the document opening will be rolled back
            bool allErrorsResolved = true;
            foreach (var failure in failures)
            {
                if (failure.GetSeverity() == FailureSeverity.Error)
                {
                    bool resolved = HandleError(failuresAccessor, failure);
                    if (!resolved)
                    {
                        allErrorsResolved = false;
                        LogError($"[PROCESSOR] Failed to resolve error: {failure.GetDescriptionText()}");
                    }
                }
            }

            // Check if we have any remaining errors
            failures = failuresAccessor.GetFailureMessages();
            int remainingErrors = failures.Count(f => f.GetSeverity() == FailureSeverity.Error);

            if (remainingErrors > 0)
            {
                HasUnresolvedErrors = true;
                LogError($"[PROCESSOR] {remainingErrors} errors remain unresolved after processing");

                // According to documentation, if we return Continue with unresolved errors,
                // Revit will treat it as ProceedWithRollBack. So we should explicitly
                // return ProceedWithRollBack to be clear about our intent
                return FailureProcessingResult.ProceedWithRollBack;
            }

            // All errors resolved successfully
            LogWithTimestamp("[PROCESSOR] All failures resolved successfully");

            // Since we resolved failures, we should return ProceedWithCommit
            // to tell Revit to try the operation again
            return FailureProcessingResult.ProceedWithCommit;
        }

        private bool HandleError(FailuresAccessor failuresAccessor, FailureMessageAccessor failure)
        {
            string description = failure.GetDescriptionText();
            FailureDefinitionId failureId = failure.GetFailureDefinitionId();
            Guid failureGuid = failureId?.Guid ?? Guid.Empty;
            LogWithTimestamp($"[PROCESSOR] Handling error: {description}");
            LogWithTimestamp($"[PROCESSOR] Failure GUID: {failureGuid}");

            // Log if this is a known failure type
            if (_knownFailures.ContainsKey(failureGuid))
            {
                LogWithTimestamp($"[PROCESSOR] Recognized failure type: {_knownFailures[failureGuid]}");
            }

            // Log the current resolution type if one is set
            try
            {
                FailureResolutionType currentResolution = failure.GetCurrentResolutionType();
                LogWithTimestamp($"[PROCESSOR] Current resolution type: {currentResolution}");
            }
            catch
            {
                LogWithTimestamp("[PROCESSOR] No current resolution type set");
            }

            // Log number of available resolutions
            if (failure.HasResolutions())
            {
                LogWithTimestamp($"[PROCESSOR] Number of resolutions available: {failure.GetNumberOfResolutions()}");
            }

            // Strategy 1: Use the default resolution if available
            if (failure.HasResolutions())
            {
                try
                {
                    // Check if there's a specific resolution we prefer
                    if (failure.HasResolutionOfType(FailureResolutionType.DeleteElements))
                    {
                        // For MEP failures, deleting elements is often the best choice
                        failure.SetCurrentResolutionType(FailureResolutionType.DeleteElements);
                        failuresAccessor.ResolveFailure(failure);
                        ErrorsResolved++;
                        LogWithTimestamp("[PROCESSOR] Resolved using DeleteElements resolution");
                        return true;
                    }
                    else if (failure.HasResolutionOfType(FailureResolutionType.DetachElements))
                    {
                        // For connectivity issues, detaching might work
                        failure.SetCurrentResolutionType(FailureResolutionType.DetachElements);
                        failuresAccessor.ResolveFailure(failure);
                        ErrorsResolved++;
                        LogWithTimestamp("[PROCESSOR] Resolved using DetachElements resolution");
                        return true;
                    }
                    else
                    {
                        // Use the default resolution
                        failuresAccessor.ResolveFailure(failure);
                        ErrorsResolved++;
                        LogWithTimestamp("[PROCESSOR] Resolved using default resolution");
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    LogError("[PROCESSOR] Failed to apply resolution", ex);
                }
            }

            // Strategy 2: If no resolution worked, try to delete the failing elements directly
            // This is our last resort to ensure the document can open
            ICollection<ElementId> failingElementIds = failure.GetFailingElementIds();
            if (failingElementIds != null && failingElementIds.Count > 0)
            {
                try
                {
                    LogWithTimestamp($"[PROCESSOR] Attempting to delete {failingElementIds.Count} failing elements as last resort");
                    // According to documentation, we can delete elements to resolve failures
                    failuresAccessor.DeleteElements(failingElementIds.ToList());
                    ElementsDeleted += failingElementIds.Count;
                    ErrorsResolved++;
                    LogWithTimestamp($"[PROCESSOR] Successfully deleted {failingElementIds.Count} failing elements");
                    return true;
                }
                catch (Exception ex)
                {
                    LogError($"[PROCESSOR] Failed to delete failing elements", ex);
                }
            }

            // If we get here, we couldn't resolve the error
            LogError($"[PROCESSOR] Unable to resolve error: {description}");
            return false;
        }

        public void Dismiss(Document document)
        {
            // This is called when the failure dialog would normally be dismissed
            // In DA, this typically means processing is complete
            LogWithTimestamp("[PROCESSOR] Failure processor dismissed");
            LogWithTimestamp($"[PROCESSOR] Final statistics - Warnings: {WarningsDeleted}, Errors: {ErrorsResolved}, Elements Deleted: {ElementsDeleted}");
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