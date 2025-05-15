// (C) Copyright 2011 by Autodesk, Inc. 
//
// Permission to use, copy, modify, and distribute this software
// in object code form for any purpose and without fee is hereby
// granted, provided that the above copyright notice appears in
// all copies and that both that copyright notice and the limited
// warranty and restricted rights notice below appear in all
// supporting documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS. 
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK,
// INC. DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL
// BE UNINTERRUPTED OR ERROR FREE.
//
// Use, duplication, or disclosure by the U.S. Government is
// subject to restrictions set forth in FAR 52.227-19 (Commercial
// Computer Software - Restricted Rights) and DFAR 252.227-7013(c)
// (1)(ii)(Rights in Technical Data and Computer Software), as
// applicable.
//

using System;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.ApplicationServices;

using DesignAutomationFramework;

namespace ADNPlugin.Revit.FileUpgrader
{
    internal class RuntimeValue
    {
        // Change this to true when publishing to Revit IO cloud
        public static bool RunOnCloud { get; } = true;
    }


    [Autodesk.Revit.Attributes.Regeneration(Autodesk.Revit.Attributes.RegenerationOption.Manual)]
    [Autodesk.Revit.Attributes.Transaction(Autodesk.Revit.Attributes.TransactionMode.Manual)]
    public class FileUpgradeApp : IExternalDBApplication
    {
        public ExternalDBApplicationResult OnStartup(ControlledApplication application)
        {
            if (RuntimeValue.RunOnCloud)
            {
                DesignAutomationBridge.DesignAutomationReadyEvent += HandleDesignAutomationReadyEvent;
            }
            else
            {
                // For local test
                application.ApplicationInitialized += HandleApplicationInitializedEvent;
            }
            return ExternalDBApplicationResult.Succeeded;
        }

        public void HandleApplicationInitializedEvent(object sender, Autodesk.Revit.DB.Events.ApplicationInitializedEventArgs e)
        {
            Application app = sender as Application;
            String filePath = Directory.GetCurrentDirectory() + @"\Change to your local legacy RFA file for local test";
            DesignAutomationData data = new DesignAutomationData(app, filePath );
            UpgradeFile(data);
        }

        public void HandleDesignAutomationReadyEvent( object sender, DesignAutomationReadyEventArgs e)
        {
            e.Succeeded = true;
            UpgradeFile(e.DesignAutomationData);
        }


        protected void UpgradeFile(DesignAutomationData data)
        {
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

                Document doc = data.RevitDoc;
                if (doc == null)
                    throw new InvalidOperationException("Could not open document.");

                // Log document information
                Console.WriteLine($"Document Title: {doc.Title}");
                Console.WriteLine($"Document Path: {doc.PathName}");
                Console.WriteLine($"Is Workshared: {doc.IsWorkshared}");
                Console.WriteLine($"Revit Version: {doc.Application.VersionName}");

                BasicFileInfo fileInfo = BasicFileInfo.Extract(modelPath);
                Console.WriteLine($"File Format: {fileInfo.Format}");
                Console.WriteLine($"Is Central Model: {fileInfo.IsCentral}");
                Console.WriteLine($"Is Worksharing Enabled: {fileInfo.IsWorkshared}");

                if (fileInfo.Format.Equals("2023"))
                {
                    Console.WriteLine("File is already in 2023 format. No upgrade needed.");
                    return;
                }

                string pathName = doc.PathName;
                string[] pathParts = pathName.Split('\\');
                string[] nameParts = pathParts[pathParts.Length - 1].Split('.');
                string extension = nameParts[nameParts.Length - 1];
                string filePath = "revitupgrade." + extension;
                ModelPath path = ModelPathUtils.ConvertUserVisiblePathToModelPath(filePath);
                Console.WriteLine($"Output path: {filePath}");

                SaveAsOptions saveOpts = new SaveAsOptions();
                Console.WriteLine("Created SaveAsOptions");

                // Check for permanent preview view
                if (doc.GetDocumentPreviewSettings().PreviewViewId.Equals(ElementId.InvalidElementId))
                {
                    Console.WriteLine("No preview view set, attempting to find 3D view");
                    // use 3D view as preview
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
                    else
                    {
                        Console.WriteLine("No suitable 3D view found for preview");
                    }
                }

                if (doc.IsWorkshared)
                {
                    Console.WriteLine("Document uses worksharing, applying appropriate save options");

                    try
                    {
                        Console.WriteLine("Workset information:");
                        FilteredWorksetCollector worksets = new FilteredWorksetCollector(doc);
                        worksets.OfKind(WorksetKind.UserWorkset);
                        Console.WriteLine($"Number of user worksets: {worksets.Count()}");

                        foreach (Workset ws in worksets)
                        {
                            Console.WriteLine($"  Workset: {ws.Name}, ID: {ws.Id}, Owner: {ws.Owner}");
                        }

                        // Create and configure worksharing options
                        WorksharingSaveAsOptions wsOptions = new WorksharingSaveAsOptions();
                        wsOptions.SaveAsCentral = true;
                        Console.WriteLine("Created WorksharingSaveAsOptions with SaveAsCentral = true");

                        // Add these additional settings for preserving worksets
                        wsOptions.OpenWorksetsDefault = SimpleWorksetConfiguration.AllWorksets;
                        Console.WriteLine("Set OpenWorksetsDefault = AllWorksets");

                        saveOpts.SetWorksharingOptions(wsOptions);
                        Console.WriteLine("Applied worksharing options to SaveAsOptions");

                        // Prevent data reorganization
                        saveOpts.Compact = false;
                        Console.WriteLine("Set Compact = false to preserve workset structure");
                    }
                    catch (Exception wsEx)
                    {
                        Console.WriteLine($"Error while setting up worksharing options: {wsEx.Message}");
                        Console.WriteLine($"Stack trace: {wsEx.StackTrace}");
                        throw;
                    }
                }
                else
                {
                    Console.WriteLine("Document does not use worksharing");
                }

                Console.WriteLine("Saving the output file: " + filePath);
                try
                {
                    doc.SaveAs(path, saveOpts);
                    Console.WriteLine("File saved successfully");
                }
                catch (Exception saveEx)
                {
                    Console.WriteLine($"ERROR DURING SAVE: {saveEx.GetType().Name}: {saveEx.Message}");
                    Console.WriteLine($"Stack trace: {saveEx.StackTrace}");

                    // Log more details about the exception 
                    if (saveEx.InnerException != null)
                    {
                        Console.WriteLine($"Inner exception: {saveEx.InnerException.Message}");
                    }

                    // Try alternative save approach if the first one fails
                    Console.WriteLine("Attempting alternative save approach...");
                    try
                    {
                        // Create completely new save options as a fallback
                        SaveAsOptions fallbackOptions = new SaveAsOptions();
                        if (doc.IsWorkshared)
                        {
                            WorksharingSaveAsOptions fallbackWsOptions = new WorksharingSaveAsOptions();
                            fallbackWsOptions.SaveAsCentral = true;
                            fallbackOptions.SetWorksharingOptions(fallbackWsOptions);

                            // Try a more forceful approach with different settings
                            Console.WriteLine("Using fallback worksharing save options");
                        }

                        doc.SaveAs(path, fallbackOptions);
                        Console.WriteLine("Fallback save successful");
                    }
                    catch (Exception fallbackEx)
                    {
                        Console.WriteLine($"Fallback save also failed: {fallbackEx.Message}");
                        throw; // Re-throw after logging
                    }
                }

                Console.WriteLine("==== FILE UPGRADE PROCESS COMPLETED ====");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"==== CRITICAL ERROR IN UPGRADE PROCESS: {ex.GetType().Name} ====");
                Console.WriteLine($"Message: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");

                // Always rethrow to ensure Design Automation knows there was a problem
                throw;
            }
        }


        public ExternalDBApplicationResult OnShutdown(ControlledApplication application)
        {

            return ExternalDBApplicationResult.Succeeded;
        }
    };

}
