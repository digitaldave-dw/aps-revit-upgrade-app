/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Autodesk Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

const express = require('express');
const config = require('../config');
const request = require("request");

const { ItemsApi, VersionsApi, FoldersApi } = require('forge-apis');

const { OAuth } = require('./common/oauthImp');

const { 
    getWorkitemStatus, 
    cancelWorkitem,
    upgradeFile, 
    getLatestVersionInfo, 
    getNewCreatedStorageInfo, 
    createBodyOfPostVersion,
    createBodyOfPostItem,
    workitemList,
    isFileAlreadyUpgraded,
    logPayload,
    createNewVersionDirectApi,
    checkFileExists,
} = require('./common/da4revitImp')

const SOCKET_TOPIC_WORKITEM = 'Workitem-Notification';
const SOCKET_TOPIC_BULK_PROGRESS = 'Bulk-Progress-Notification';

let router = express.Router();


// Enhanced queue management system
class BulkProcessingQueue {
    constructor() {
        this.queue = [];
        this.processing = new Map(); // Track currently processing items
        this.completed = new Map();  // Track completed items
        this.failed = new Map();     // Track failed items
        this.maxConcurrent = 5;      // Max concurrent workitems
        this.batchId = 0;           // Unique identifier for bulk operations
        this.pendingFiles = [];     // Files waiting to be processed
        this.isProcessing = false;  // Flag to prevent concurrent processing
    }

    // Add files to processing queue
    addBulkJob(files, options) {
        const batchId = ++this.batchId;
        const bulkJob = {
            batchId,
            files: files.map((file, index) => ({
                ...file,
                fileIndex: index,
                status: 'queued',
                attempts: 0,
                maxAttempts: 3
            })),
            options,
            createdAt: new Date(),
            totalFiles: files.length,
            completedFiles: 0,
            failedFiles: 0,
            submittedFiles: 0  // Track files submitted to DA
        };

        this.queue.push(bulkJob);
        console.log(`Added bulk job ${batchId} with ${files.length} files to queue`);
        
        // Start processing if not already running
        this.processQueue();
        
        return batchId;
    }

    // Main queue processor
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const currentJob = this.queue[0];
                
                // Send initial progress
                this.emitProgress(currentJob);
                
                await this.processBulkJob(currentJob);
                
                // Remove completed job from queue
                this.queue.shift();
                
                // Final progress update
                this.emitProgress(currentJob, true);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    // Process a single bulk job with proper queue management
    async processBulkJob(bulkJob) {
        console.log(`Processing bulk job ${bulkJob.batchId} with ${bulkJob.totalFiles} files`);
        
        // Initialize pending files list
        this.pendingFiles = [...bulkJob.files];
        
        // Process files until all are done or permanently failed
        while (this.pendingFiles.length > 0 || this.processing.size > 0) {
            // Process available slots
            await this.fillAvailableSlots(bulkJob);
            
            // Wait a bit before checking again
            await this.sleep(2000);
            
            // Update progress
            this.emitProgress(bulkJob);
        }
        
        console.log(`Bulk job ${bulkJob.batchId} completed: ${bulkJob.completedFiles} success, ${bulkJob.failedFiles} failed`);
    }

    // Fill available processing slots
    async fillAvailableSlots(bulkJob) {
        const availableSlots = this.maxConcurrent - this.processing.size;
        
        if (availableSlots <= 0 || this.pendingFiles.length === 0) {
            return; // No slots available or no files to process
        }

        // Take files for available slots
        const filesToProcess = this.pendingFiles.splice(0, availableSlots);
        
        // Process each file
        for (const file of filesToProcess) {
            this.processFileAsync(file, bulkJob);
        }
    }

    // Process file asynchronously (fire and forget)
    async processFileAsync(file, bulkJob) {
        const processingKey = `${file.fileItemId}_${Date.now()}`;
        
        try {
            // Mark as processing
            file.status = 'processing';
            file.attempts++;
            this.processing.set(processingKey, file);
            
            console.log(`Submitting file to DA: ${file.fileItemName} (attempt ${file.attempts})`);
            
            // Submit to Design Automation
            const result = await this.submitToDesignAutomation(file, bulkJob.options);
            
            if (result.success) {
                // File submitted successfully - it will complete via webhook
                file.workItemId = result.workItemId;
                file.status = 'submitted';
                bulkJob.submittedFiles++;
                
                // Store workitem info for webhook callback
                if (!global.bulkJobWorkitems) {
                    global.bulkJobWorkitems = new Map();
                }
                global.bulkJobWorkitems.set(result.workItemId, {
                    bulkJob,
                    file,
                    processingKey
                });
                
                console.log(`File submitted to DA: ${file.fileItemName}, workitem: ${result.workItemId}`);
            } else {
                throw new Error(result.error || 'Failed to submit to DA');
            }
            
        } catch (error) {
            console.error(`Error processing ${file.fileItemName}:`, error.message);
            
            // Check if we should retry
            if (this.shouldRetry(error, file)) {
                // Put back in pending queue for retry
                file.status = 'queued';
                this.pendingFiles.push(file);
                console.log(`File ${file.fileItemName} queued for retry (${file.maxAttempts - file.attempts} attempts left)`);
            } else {
                // Permanent failure
                this.handleFileFailed(file, bulkJob, error);
            }
            
            // Remove from processing
            this.processing.delete(processingKey);
        }
    }

    // Check if error is retryable
    shouldRetry(error, file) {
        // Check if we have attempts left
        if (file.attempts >= file.maxAttempts) {
            return false;
        }
        
        // Check error type
        const errorMessage = error.message || '';
        const retryableErrors = [
            'Maximum concurrent workitems reached',
            'Rate limit exceeded',
            'quota exceeded',
            'ETIMEDOUT',
            'ECONNRESET'
        ];
        
        return retryableErrors.some(retryable => 
            errorMessage.toLowerCase().includes(retryable.toLowerCase())
        );
    }

    // Submit file to Design Automation
    async submitToDesignAutomation(file, options) {
        try {
            console.log(`📋 Preparing bulk file for DA: ${file.fileItemName}`);
            
            // Extract project and resource IDs from file URL
            const params = file.fileItemId.split('/');
            const resourceId = params[params.length - 1];
            const projectId = params[params.length - 3];

            // Get parent folder information
            const items = new ItemsApi();
            const folder = await items.getItemParentFolder(
                projectId, 
                resourceId, 
                options.oauth_client, 
                options.oauth_token
            );
            
            if (!folder || folder.statusCode !== 200) {
                throw new Error('Failed to get parent folder');
            }

            // Create new storage for the upgraded file
            const storageInfo = await getNewCreatedStorageInfo(
                projectId, 
                folder.body.data.id, 
                file.fileItemName, 
                options.oauth_client, 
                options.oauth_token
            );
            
            if (!storageInfo) {
                throw new Error('Failed to create storage');
            }

            // Get version information
            const versionInfo = await getLatestVersionInfo(
                projectId, 
                resourceId, 
                options.oauth_client, 
                options.oauth_token
            );
            
            if (!versionInfo) {
                throw new Error('Failed to get version information');
            }
            
            // Create version creation payload with target version
            const createVersionBody = createBodyOfPostVersion(
                resourceId,
                file.fileItemName, 
                storageInfo.StorageId,
                versionInfo.versionType,
                options.targetVersion  // Use targetVersion from bulk options
            );

            // Get file extension
            const fileExtension = file.fileItemName.split('.').pop().toLowerCase();

            console.log(`📤 Submitting bulk file to DA: ${file.fileItemName} → Revit ${options.targetVersion}`);

            // Submit to Design Automation with target version
            const upgradeRes = await upgradeFile(
                versionInfo.versionStorageId, 
                storageInfo.StorageId, 
                projectId, 
                createVersionBody, 
                fileExtension, 
                options.oauth_token, 
                options.oauth_token_2legged,
                true,                        // isNewVersion
                options.targetVersion        // CRITICAL: Pass the target version!
            );

            // Store all necessary data for webhook callback
            if (!global.bulkJobWorkitems) {
                global.bulkJobWorkitems = new Map();
            }
            
            // Store workitem data including target version
            global.bulkJobWorkitems.set(upgradeRes.body.id, {
                bulkJob: this.queue[0],      // Current bulk job
                file: file,
                processingKey: `${file.fileItemId}_${Date.now()}`,
                createVersionData: createVersionBody,
                projectId: projectId,
                oauth_client: options.oauth_client,
                oauth_token: options.oauth_token,
                targetVersion: options.targetVersion  // Store for logging
            });

            console.log(`✅ Bulk file submitted: ${file.fileItemName}`);
            console.log(`   Workitem: ${upgradeRes.body.id}`);
            console.log(`   Activity: FileUpgraderApp_${options.targetVersion}Activity`);

            return {
                success: true,
                workItemId: upgradeRes.body.id,
                workItemStatus: upgradeRes.body.status,
                targetVersion: options.targetVersion
            };

        } catch (error) {
            console.log(`❌ Failed to submit ${file.fileItemName}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }


    // Updated fillAvailableSlots method with better tracking
    async fillAvailableSlots(bulkJob) {
        // Import the tracker
        const { workitemTracker } = require('./common/da4revitImp');
        
        const activeCount = workitemTracker.getActiveCount();
        const availableSlots = this.maxConcurrent - activeCount;
        
        console.log(`Fill slots: Active=${activeCount}, Available=${availableSlots}, Pending=${this.pendingFiles.length}`);
        
        if (availableSlots <= 0 || this.pendingFiles.length === 0) {
            return; // No slots available or no files to process
        }

        // Take files for available slots
        const filesToProcess = this.pendingFiles.splice(0, availableSlots);
        
        // Process each file
        for (const file of filesToProcess) {
            this.processFileAsync(file, bulkJob);
        }
    }

    // Updated handleFileCompleted to trigger processing of pending files
    handleFileCompleted(workItemId) {
        const workitemInfo = global.bulkJobWorkitems?.get(workItemId);
        if (!workitemInfo) {
            console.log(`No bulk job info found for workitem ${workItemId}`);
            return;
        }

        const { bulkJob, file, processingKey } = workitemInfo;
        
        // Update file status
        file.status = 'completed';
        file.completedAt = new Date();
        
        // Update job counters
        bulkJob.completedFiles++;
        
        // Move to completed
        this.completed.set(file.fileItemId, file);
        this.processing.delete(processingKey);
        
        // Clean up
        global.bulkJobWorkitems.delete(workItemId);
        
        console.log(`File completed: ${file.fileItemName} (${bulkJob.completedFiles}/${bulkJob.totalFiles})`);
        
        // Emit progress update
        this.emitProgress(bulkJob);
        
        // CRITICAL: Try to process more files if available
        setTimeout(() => {
            this.fillAvailableSlots(bulkJob);
        }, 1000); // Small delay to ensure tracker is updated
    }

    // Handle file failure (called from webhook or processing error)
    handleFileFailed(file, bulkJob, error) {
        file.status = 'failed';
        file.error = error.message || 'Unknown error';
        file.failedAt = new Date();
        
        bulkJob.failedFiles++;
        this.failed.set(file.fileItemId, file);
        
        console.log(`File failed permanently: ${file.fileItemName} - ${file.error}`);
    }

    // Emit progress updates via WebSocket
    emitProgress(bulkJob, isComplete = false) {
        const progress = {
            batchId: bulkJob.batchId,
            totalFiles: bulkJob.totalFiles,
            completedFiles: bulkJob.completedFiles,
            failedFiles: bulkJob.failedFiles,
            processingFiles: this.processing.size,
            queuedFiles: this.pendingFiles.length,
            submittedFiles: bulkJob.submittedFiles,
            isComplete,
            percentComplete: Math.round((bulkJob.completedFiles + bulkJob.failedFiles) / bulkJob.totalFiles * 100),
            files: bulkJob.files.map(f => ({
                name: f.fileItemName,
                status: f.status,
                attempts: f.attempts,
                workItemId: f.workItemId,
                error: f.error
            }))
        };

        if (global.MyApp && global.MyApp.SocketIo) {
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_BULK_PROGRESS, progress);
        }
    }

    // Utility sleep function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get job status
    getJobStatus(batchId) {
        const job = this.queue.find(j => j.batchId === batchId);
        if (!job) return null;

        return {
            batchId: job.batchId,
            status: job.completedFiles + job.failedFiles >= job.totalFiles ? 'completed' : 'processing',
            totalFiles: job.totalFiles,
            completedFiles: job.completedFiles,
            failedFiles: job.failedFiles,
            processingFiles: this.processing.size,
            queuedFiles: this.pendingFiles.length,
            submittedFiles: job.submittedFiles,
            percentComplete: Math.round((job.completedFiles + job.failedFiles) / job.totalFiles * 100),
            files: job.files
        };
    }

    // Cancel bulk job
    async cancelJob(batchId, oauth_token) {
        const jobIndex = this.queue.findIndex(j => j.batchId === batchId);
        if (jobIndex === -1) return false;
        
        const job = this.queue[jobIndex];
        
        // Cancel active workitems
        const cancelPromises = [];
        for (const [workItemId, info] of (global.bulkJobWorkitems || new Map()).entries()) {
            if (info.bulkJob.batchId === batchId) {
                cancelPromises.push(
                    cancelWorkitem(workItemId, oauth_token)
                        .catch(err => console.log(`Failed to cancel workitem ${workItemId}:`, err))
                );
            }
        }
        
        await Promise.allSettled(cancelPromises);
        
        // Clear pending files
        this.pendingFiles = [];
        
        // Remove job
        this.queue.splice(jobIndex, 1);
        
        return true;
    }
}

// Global queue instance
const bulkQueue = new BulkProcessingQueue();

///////////////////////////////////////////////////////////////////////
/// Middleware for obtaining a token for each request.
///////////////////////////////////////////////////////////////////////
router.use(async (req, res, next) => {
    const oauth = new OAuth(req.session);
    let credentials = await oauth.getInternalToken();
    let oauth_client = oauth.getClient();

    if(credentials ){
        req.oauth_client = oauth_client;
        req.oauth_token = credentials;
        next();
    }
});


///////////////////////////////////////////////////////////////////////
/// UPDATED: Bulk upgrade endpoint
/// This endpoint remains mostly the same but ensures targetVersion is passed
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/bulk', async (req, res, next) => {
    const { 
        folderId, 
        projectId, 
        targetVersion = "2023",  // Default to 2023 if not specified
        supportedTypes = ['rvt', 'rfa', 'rte'] 
    } = req.body;

    // Validate inputs
    if (!folderId || !projectId) {
        return res.status(400).json({ error: 'folderId and projectId are required' });
    }

    // Validate target version
    if (targetVersion !== '2023' && targetVersion !== '2024') {
        return res.status(400).json({ 
            error: 'Invalid target version',
            message: 'Target version must be either 2023 or 2024'
        });
    }

    try {
        console.log('🚀 Starting bulk processing:', { 
            projectId, 
            folderId, 
            targetVersion, 
            supportedTypes 
        });

        // Import the helper function
        const { getFolderContentsForUpgrade, isWorksharingFile } = require('./common/datamanagementImp');
        
        // Get folder contents with worksharing filtering
        const folderData = await getFolderContentsForUpgrade(
            projectId, 
            folderId, 
            req.oauth_client, 
            req.oauth_token
        );
        
        // Get the upgradeable items (already filtered for non-workshared files)
        const revitFiles = folderData.upgradeableItems.filter(item => {
            const fileName = item.attributes.displayName || item.attributes.name;
            const extension = fileName.split('.').pop().toLowerCase();
            return supportedTypes.includes(extension);
        });

        // Count excluded workshared files
        const excludedWorksharedFiles = folderData.allItems.filter(item => {
            if (item.type !== 'items') return false;
            const fileName = item.attributes.displayName || item.attributes.name;
            if (!fileName) return false;
            const extension = fileName.split('.').pop().toLowerCase();
            
            // Check if it would have been included but is workshared
            return supportedTypes.includes(extension) && isWorksharingFile(item);
        });

        console.log(`📊 Found ${revitFiles.length} files for bulk processing`);
        console.log(`⚠️  Excluded ${excludedWorksharedFiles.length} workshared files`);

        if (revitFiles.length === 0) {
            let errorMessage = 'No supported Revit files found in folder';
            
            if (excludedWorksharedFiles.length > 0) {
                errorMessage += `. ${excludedWorksharedFiles.length} workshared files were excluded from processing`;
            }
            
            return res.status(404).json({ 
                error: errorMessage,
                supportedExtensions: supportedTypes,
                targetVersion: targetVersion,
                excludedWorksharedCount: excludedWorksharedFiles.length,
                excludedWorksharedFiles: excludedWorksharedFiles.map(f => 
                    f.attributes.displayName || f.attributes.name
                )
            });
        }

        // Prepare files for queue
        const filesToProcess = revitFiles.map(item => ({
            fileItemId: item.links.self.href,
            fileItemName: item.attributes.displayName || item.attributes.name,
            projectId: projectId,
            itemId: item.id,
            extensionType: item.attributes.extension?.type || 'unknown'
        }));

        // Get 2-legged token for Design Automation
        const oauth = new OAuth(req.session);
        const oauth_client_2legged = oauth.get2LeggedClient();
        const oauth_token_2legged = await oauth_client_2legged.authenticate();

        // Add to processing queue with target version
        const batchId = bulkQueue.addBulkJob(filesToProcess, {
            targetVersion,              // CRITICAL: Include target version
            oauth_client: req.oauth_client,
            oauth_token: req.oauth_token,
            oauth_token_2legged
        });

        console.log(`✅ Bulk job created: ${batchId}`);
        console.log(`   Files: ${filesToProcess.length}`);
        console.log(`   Target: Revit ${targetVersion}`);
        console.log(`   Activity: FileUpgraderApp_${targetVersion}Activity`);

        res.json({
            success: true,
            batchId,
            totalFiles: filesToProcess.length,
            targetVersion: targetVersion,
            activityUsed: `FileUpgraderApp_${targetVersion}Activity`,
            excludedWorksharedCount: excludedWorksharedFiles.length,
            message: `Started bulk processing of ${filesToProcess.length} files to Revit ${targetVersion}` + 
                     (excludedWorksharedFiles.length > 0 ? 
                      ` (${excludedWorksharedFiles.length} workshared files excluded)` : ''),
            files: filesToProcess.map(f => f.fileItemName),
            excludedFiles: excludedWorksharedFiles.map(f => 
                f.attributes.displayName || f.attributes.name
            )
        });

    } catch (err) {
        console.log('❌ Error in bulk processing:', err);
        res.status(500).json({ 
            error: 'Failed to start bulk processing',
            details: err.message,
            targetVersion: targetVersion
        });
    }
});

///////////////////////////////////////////////////////////////////////
/// NEW: Get bulk processing status
///////////////////////////////////////////////////////////////////////
router.get('/da4revit/v1/upgrader/bulk/:batchId/status', async (req, res, next) => {
    const { batchId } = req.params;
    
    const status = bulkQueue.getJobStatus(parseInt(batchId));
    
    if (!status) {
        return res.status(404).json({ error: 'Batch job not found' });
    }
    
    res.json(status);
});

///////////////////////////////////////////////////////////////////////
/// NEW: Cancel bulk processing job
///////////////////////////////////////////////////////////////////////
router.delete('/da4revit/v1/upgrader/bulk/:batchId', async (req, res, next) => {
    const { batchId } = req.params;
    
    try {
        // Find and cancel the job
        const jobIndex = bulkQueue.queue.findIndex(j => j.batchId === parseInt(batchId));
        
        if (jobIndex === -1) {
            return res.status(404).json({ error: 'Batch job not found' });
        }
        
        const job = bulkQueue.queue[jobIndex];
        
        // Cancel any active workitems for this job
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();
        const oauth_token = await oauth_client.authenticate();
        
        const cancelPromises = job.files
            .filter(f => f.workItemId && f.status === 'processing')
            .map(f => cancelWorkitem(f.workItemId, oauth_token.access_token).catch(err => 
                console.log(`Failed to cancel workitem ${f.workItemId}:`, err)
            ));
        
        await Promise.allSettled(cancelPromises);
        
        // Remove job from queue
        bulkQueue.queue.splice(jobIndex, 1);
        
        res.json({ 
            success: true, 
            message: `Cancelled bulk job ${batchId}`,
            cancelledWorkitems: cancelPromises.length
        });
        
    } catch (err) {
        console.log('Error cancelling bulk job:', err);
        res.status(500).json({ 
            error: 'Failed to cancel bulk job',
            details: err.message 
        });
    }
});


///////////////////////////////////////////////////////////////////////
/// upgrade revit file to specified version using Design Automation 
/// for Revit API
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files', async (req, res, next) => {
    const fileItemId = req.body.fileItemId;
    const fileItemName = req.body.fileItemName;
    const targetVersion = req.body.targetVersion || "2023"; // Get target version from request, default to 2023

    // Validate inputs
    if (fileItemId === '' || fileItemName === '') {
        console.log('info: Missing file ID or name');
        res.status(400).end('fileItemId and fileItemName are required');
        return;
    }

    // Extract project and resource IDs from the file path
    const params = fileItemId.split('/');
    if (params.length < 3) {
        console.log('info: Invalid file URL format');
        res.status(400).end('Invalid file URL format');
        return;
    }
    
    const resourceId = params[params.length - 1];
    const projectId = params[params.length - 3];

    // Validate target version
    if (targetVersion !== '2023' && targetVersion !== '2024') {
        console.log('info: Invalid target version specified');
        res.status(400).end('Target version must be either 2023 or 2024');
        return;
    }

    console.log(`🚀 Starting upgrade: ${fileItemName} → Revit ${targetVersion}`);
    console.log(`   Project: ${projectId}, Resource: ${resourceId}`);

    try {
        // Get the parent folder of the file
        const items = new ItemsApi();
        const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, req.oauth_token);
        if (!folder || folder.statusCode !== 200) {
            throw new Error('Failed to get parent folder');
        }

        // Get the latest version information
        const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, req.oauth_token);
        if (!versionInfo) {
            throw new Error('Failed to get latest version information');
        }

        // Create new storage for the upgraded file
        const storageInfo = await getNewCreatedStorageInfo(
            projectId, 
            folder.body.data.id, 
            fileItemName, 
            req.oauth_client, 
            req.oauth_token
        );
        if (!storageInfo) {
            throw new Error('Failed to create storage for upgraded file');
        }

        // Extract file extension for validation
        const fileExtension = fileItemName.split('.').pop().toLowerCase();
        if (fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'rte') {
            console.log('info: Unsupported file format');
            res.status(400).end('Only RVT, RFA, and RTE files are supported');
            return;
        }

        // Create the version creation payload
        const createVersionBody = createBodyOfPostVersion(
            resourceId,                // fileId
            fileItemName,             // fileName
            storageInfo.StorageId,    // storageId
            versionInfo.versionType,  // versionType (e.g., "autodesk.bim360:File")
            targetVersion            // targetVersion for metadata
        );
        
        // Ensure the data type is correct for version creation
        createVersionBody.data.type = "versions";
        
        // Get 2-legged OAuth token for Design Automation
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();
        const oauth_token = await oauth_client.authenticate();
        
        console.log(`📤 Submitting to Design Automation for Revit ${targetVersion} upgrade`);
        console.log(`   Input storage: ${versionInfo.versionStorageId}`);
        console.log(`   Output storage: ${storageInfo.StorageId}`);
        console.log(`   Webhook URL: ${designAutomation.webhook_url}`);
        
        // Submit the upgrade job to Design Automation
        // CRITICAL: Pass the targetVersion parameter
        let upgradeRes = await upgradeFile(
            versionInfo.versionStorageId,  // input storage URL
            storageInfo.StorageId,         // output storage URL
            projectId,                     // project ID for version creation
            createVersionBody,             // version creation payload
            fileExtension,                 // file extension (rvt, rfa, rte)
            req.oauth_token,               // 3-legged token for BIM360
            oauth_token,                   // 2-legged token for DA
            true,                          // isNewVersion = true
            targetVersion                  // CRITICAL: Pass the target version!
        );
        
        console.log(`✅ Workitem submitted: ${upgradeRes.body.id}`);
        console.log(`   Status: ${upgradeRes.body.status}`);
        console.log(`   Activity: FileUpgraderApp_${targetVersion}Activity`);
        
        // Return success response with workitem details
        res.status(200).json({
            "fileName": fileItemName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status,
            "targetVersion": targetVersion,
            "activityUsed": `FileUpgraderApp_${targetVersion}Activity`,
            "message": `Upgrading ${fileItemName} to Revit ${targetVersion}`
        });
        
    } catch (err) {
        console.log('❌ Upgrade error:', err.message);
        console.log('   Stack:', err.stack);
        
        // Return detailed error response
        res.status(500).json({
            error: 'Failed to upgrade file',
            details: err.message,
            fileName: fileItemName,
            targetVersion: targetVersion
        });
    }
});


///////////////////////////////////////////////////////////////////////
/// UPDATED: Endpoint for copying and upgrading files to a different folder
/// This handles the case where users want to upgrade a file and save it to a different location
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files/:source_file_url/folders/:destinate_folder_url', async (req, res, next) => {
    const sourceFileUrl = (req.params.source_file_url); 
    const destinateFolderUrl = (req.params.destinate_folder_url);
    const targetVersion = req.body.targetVersion || "2023"; // Add support for target version
    
    // Validate inputs
    if (sourceFileUrl === '' || destinateFolderUrl === '') {
        res.status(400).end('Source file and destination folder URLs are required');
        return;
    }
    
    // Parse URLs to extract IDs
    const sourceFileParams = sourceFileUrl.split('/');
    const destinateFolderParams = destinateFolderUrl.split('/');
    
    if (sourceFileParams.length < 3 || destinateFolderParams.length < 3) {
        console.log('info: Invalid URL format');
        res.status(400).end('Invalid URL format');
        return;
    }

    // Validate URL types
    const sourceFileType = sourceFileParams[sourceFileParams.length - 2];
    const destinateFolderType = destinateFolderParams[destinateFolderParams.length - 2];
    
    if (sourceFileType !== 'items' || destinateFolderType !== 'folders') {
        console.log('info: Invalid source or destination type');
        res.status(400).end('Source must be an item and destination must be a folder');
        return;
    }

    // Extract IDs from URLs
    const sourceFileId = sourceFileParams[sourceFileParams.length - 1];
    const sourceProjectId = sourceFileParams[sourceFileParams.length - 3];
    const destinateFolderId = destinateFolderParams[destinateFolderParams.length - 1];
    const destinateProjectId = destinateFolderParams[destinateFolderParams.length - 3];

    // Validate target version
    if (targetVersion !== '2023' && targetVersion !== '2024') {
        console.log('info: Invalid target version specified');
        res.status(400).end('Target version must be either 2023 or 2024');
        return;
    }

    console.log(`📁 Cross-folder upgrade: ${sourceFileId} → ${destinateFolderId} (Revit ${targetVersion})`);

    try {
        // Get the storage of the input item version
        const versionInfo = await getLatestVersionInfo(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (versionInfo === null) {
            console.log('error: Failed to get latest version of the file');
            res.status(500).end('Failed to get latest version of the file');
            return;
        }
        const inputStorageId = versionInfo.versionStorageId;

        // Get source file information
        const items = new ItemsApi();
        const sourceFile = await items.getItem(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (sourceFile === null || sourceFile.statusCode !== 200) {
            console.log('error: Failed to get the source file item');
            res.status(500).end('Failed to get the source file item');
            return;
        }
        
        const fileName = sourceFile.body.data.attributes.displayName;
        const itemType = sourceFile.body.data.attributes.extension.type;

        // Validate file extension
        const fileParams = fileName.split('.');
        const fileExtension = fileParams[fileParams.length-1].toLowerCase();
        if (fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'rte') {
            console.log('info: Unsupported file format');
            res.status(400).end('Only RVT, RFA, and RTE files are supported');
            return;
        }
    
        // Create a new storage in the destination folder
        const storageInfo = await getNewCreatedStorageInfo(
            destinateProjectId, 
            destinateFolderId, 
            fileName, 
            req.oauth_client, 
            req.oauth_token
        );
        if (storageInfo === null) {
            console.log('error: Failed to create storage in destination');
            res.status(500).end('Failed to create storage in destination');
            return;
        }

        // Create the payload for posting a new item (not a version)
        const createFirstVersionBody = createBodyOfPostItem(
            fileName, 
            destinateFolderId, 
            storageInfo.StorageId, 
            itemType, 
            versionInfo.versionType
        );
        if (createFirstVersionBody === null) {
            console.log('error: Failed to create item creation payload');
            res.status(500).end('Failed to create item creation payload');
            return;
        }

        // Get 2-legged token for Design Automation
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();
        const oauth_token = await oauth_client.authenticate();
        
        console.log(`📤 Submitting cross-folder upgrade to DA for Revit ${targetVersion}`);
        console.log(`   Source: ${fileName} from project ${sourceProjectId}`);
        console.log(`   Destination: folder ${destinateFolderId} in project ${destinateProjectId}`);
        
        // Submit the upgrade job to Design Automation
        // CRITICAL: Pass the targetVersion parameter
        let upgradeRes = await upgradeFile(
            inputStorageId,           // input storage URL from source file
            storageInfo.StorageId,    // output storage URL in destination
            destinateProjectId,       // destination project ID
            createFirstVersionBody,   // item creation payload
            fileExtension,            // file extension
            req.oauth_token,          // 3-legged token
            oauth_token,              // 2-legged token
            false,                    // isNewVersion = false (creating new item)
            targetVersion             // CRITICAL: Pass the target version!
        );
        
        if (upgradeRes === null || upgradeRes.statusCode !== 200) {
            console.log('error: Failed to submit upgrade job');
            res.status(500).end('Failed to submit upgrade job');
            return;
        }
        
        console.log(`✅ Cross-folder workitem submitted: ${upgradeRes.body.id}`);
        console.log(`   Activity: FileUpgraderApp_${targetVersion}Activity`);
        
        // Return success response
        const upgradeInfo = {
            "fileName": fileName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status,
            "targetVersion": targetVersion,
            "activityUsed": `FileUpgraderApp_${targetVersion}Activity`,
            "sourceProject": sourceProjectId,
            "destinationProject": destinateProjectId,
            "message": `Copying and upgrading ${fileName} to Revit ${targetVersion}`
        };
        res.status(200).end(JSON.stringify(upgradeInfo));

    } catch (err) {
        console.log('❌ Cross-folder upgrade error:', err);
        
        if (typeof err === 'object') {
            if (err.statusCode) {
                return res.status(err.statusCode).json({
                    error: err.statusMessage || 'Unknown error',
                    details: err,
                    targetVersion: targetVersion
                });
            } else {
                return res.status(500).json({
                    error: err.message || 'Unknown error',
                    targetVersion: targetVersion
                });
            }
        }
        
        res.status(500).end(err.toString());
    }
});


///////////////////////////////////////////////////////////////////////
/// Cancel the file upgrade process if possible.
/// NOTE: This may not successful if the upgrade process is already started
///////////////////////////////////////////////////////////////////////
router.delete('/da4revit/v1/upgrader/files/:file_workitem_id', async(req, res, next) =>{

    const workitemId = req.params.file_workitem_id;
    try {
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();
        await cancelWorkitem(workitemId, oauth_token.access_token);
        let workitemStatus = {
            'WorkitemId': workitemId,
            'Status': "Cancelled"
        };

        const workitem = workitemList.find( (item) => {
            return item.workitemId === workitemId;
        } )
        if( workitem === undefined ){
            console.log('the workitem is not in the list')
            return;
        }
        console.log('The workitem: ' + workitemId + ' is cancelled')
        let index = workitemList.indexOf(workitem);
        workitemList.splice(index, 1);

        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        res.status(204).end();
    } catch (err) {
        res.status(500).end("error");
    }
})

///////////////////////////////////////////////////////////////////////
/// Query the status of the file
///////////////////////////////////////////////////////////////////////
router.get('/da4revit/v1/upgrader/files/:file_workitem_id', async(req, res, next) => {
    const workitemId = req.params.file_workitem_id;
    try {
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();        
        let workitemRes = await getWorkitemStatus(workitemId, oauth_token.access_token);
        res.status(200).end(JSON.stringify(workitemRes.body));
    } catch (err) {
        res.status(500).end("error");
    }
})


// Update the callback handler in da4revit.js
///////////////////////////////////////////////////////////////////////
/// Handles the callback from Design Automation after job completion
///////////////////////////////////////////////////////////////////////
router.post('/callback/designautomation', async (req, res, next) => {
    // Best practice is to acknowledge receipt immediately
    res.status(202).end();
    
    console.log(`Webhook received for workitem: ${req.body.id}, status: ${req.body.status}`);

    // CRITICAL: Update the workitem tracker when webhook is received
    const { workitemTracker } = require('./common/da4revitImp');

    let workitemStatus = {
        'WorkitemId': req.body.id,
        'Status': "Processing"
    };
    
    // Check if this is a bulk processing workitem
    const bulkWorkitemInfo = global.bulkJobWorkitems?.get(req.body.id);
    
    if (req.body.status === 'success') {
        // Find the workitem that matches this callback
        const workitem = workitemList.find((item) => {
            return item.workitemId === req.body.id;
        });

        if (!workitem && !bulkWorkitemInfo) {
            console.log('The workitem: ' + req.body.id + ' to callback is not in any list');
            // Still need to remove from tracker
            workitemTracker.removeWorkitem(req.body.id);
            return;
        }
        
        // Add a small delay to ensure DA has finished uploading the output file
        setTimeout(async () => {
            try {
                // Handle bulk processing workitem
                if (bulkWorkitemInfo) {
                    const { bulkJob, file } = bulkWorkitemInfo;
                    
                    console.log(`Processing bulk workitem callback for file: ${file.fileItemName}`);
                    
                    // Get the stored version creation data
                    const workitemData = workitemTracker.getWorkitem(req.body.id);
                    if (!workitemData || !workitemData.createVersionData) {
                        console.error('Missing version creation data for bulk workitem');
                        workitemStatus.Status = 'Failed';
                        workitemStatus.Error = 'Missing version creation data';
                        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                        
                        // Update tracker and bulk queue
                        workitemTracker.failWorkitem(req.body.id, 'Missing version data');
                        bulkQueue.handleFileFailed(file, bulkJob, new Error('Missing version data'));
                        return;
                    }
                    
                    // Get credentials from bulk job options
                    const credentials = bulkJob.options.oauth_token;
                    const oauth_client = bulkJob.options.oauth_client;
                    
                    if (!credentials || !credentials.access_token) {
                        console.log("No valid token available for bulk processing operation");
                        workitemStatus.Status = 'Failed';
                        workitemStatus.Error = 'Authentication error - missing token';
                        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                        
                        // Update tracker and bulk queue
                        workitemTracker.failWorkitem(req.body.id, 'Authentication error');
                        bulkQueue.handleFileFailed(file, bulkJob, new Error('Authentication error'));
                        return;
                    }
                    
                    // CRITICAL: Actually create the version in BIM360/ACC
                    console.log("Creating new version in BIM360/ACC for bulk processed file");
                    console.log(`Project ID: ${workitemData.projectId}`);
                    console.log(`Version data type: ${workitemData.createVersionData.data.type}`);
                    
                    let version = null;
                    let retries = 3;
                    let lastError = null;
                    
                    while (retries > 0 && !version) {
                        try {
                            if (workitemData.createVersionData.data.type === 'versions') {
                                const versions = new VersionsApi();
                                version = await versions.postVersion(
                                    workitemData.projectId, 
                                    workitemData.createVersionData, 
                                    oauth_client, 
                                    credentials
                                );
                            } else {
                                const items = new ItemsApi();
                                version = await items.postItem(
                                    workitemData.projectId, 
                                    workitemData.createVersionData, 
                                    oauth_client, 
                                    credentials
                                );
                            }
                            
                            if (version && version.statusCode === 201) {
                                console.log(`Successfully created version for ${file.fileItemName}`);
                                break; // Success
                            }
                        } catch (err) {
                            lastError = err;
                            retries--;
                            
                            if (retries > 0) {
                                console.log(`Retry ${3 - retries}/3 after error:`, err.message);
                                await new Promise(resolve => setTimeout(resolve, (4 - retries) * 1000));
                            }
                        }
                    }
                    
                    if (version && version.statusCode === 201) {
                        console.log('Successfully created a new version of the file');
                        workitemStatus.Status = 'Completed';
                        
                        // Update tracker
                        workitemTracker.completeWorkitem(req.body.id, 'success');
                        
                        // Update bulk queue
                        bulkQueue.handleFileCompleted(req.body.id);
                        
                        // Emit completion status
                        setTimeout(() => {
                            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                        }, 100);
                    } else {
                        throw lastError || new Error('Failed to create version after retries');
                    }
                    
                } else {
                    // Handle regular (non-bulk) workitem
                    const type = workitem.createVersionData.data.type;
                    const credentials = workitem.access_token_3Legged;
                    
                    if (!credentials || !credentials.access_token) {
                        console.log("No valid token available in workitem for BIM360/ACC operation");
                        workitemStatus.Status = 'Failed';
                        workitemStatus.Error = 'Authentication error - missing token';
                        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                        
                        // Update tracker
                        workitemTracker.failWorkitem(req.body.id, 'Authentication error');
                        removeWorkitemFromList(workitem);
                        return;
                    }
                    
                    console.log("Using token from workitem for BIM360 operation");
                    console.log(`Creating ${type === "versions" ? "new version" : "new item"} in BIM360/ACC`);
                    console.log(`Project ID: ${workitem.projectId}`);
                    
                    // Regular version creation logic (same as before)
                    let version = null;
                    let retries = 3;
                    let lastError = null;
                    
                    while (retries > 0 && !version) {
                        try {
                            const oauth = new OAuth();
                            const oauth_client = oauth.getClient();
                            
                            if (type === "versions") {
                                const versions = new VersionsApi();
                                version = await versions.postVersion(
                                    workitem.projectId, 
                                    workitem.createVersionData, 
                                    oauth_client, 
                                    credentials
                                );
                            } else {
                                const items = new ItemsApi();
                                version = await items.postItem(
                                    workitem.projectId, 
                                    workitem.createVersionData, 
                                    oauth_client, 
                                    credentials
                                );
                            }
                            
                            if (version && version.statusCode === 201) {
                                break; // Success
                            }
                        } catch (err) {
                            lastError = err;
                            retries--;
                            
                            if (retries > 0) {
                                console.log(`Retry ${3 - retries}/3 after error:`, err.message);
                                await new Promise(resolve => setTimeout(resolve, (4 - retries) * 1000));
                            }
                        }
                    }
                    
                    if (version && version.statusCode === 201) {
                        console.log('Successfully created a new version of the file');
                        workitemStatus.Status = 'Completed';
                        
                        // Update tracker
                        workitemTracker.completeWorkitem(req.body.id, 'success');
                        
                        setTimeout(() => {
                            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                        }, 100);
                    } else {
                        throw lastError || new Error('Failed to create version after retries');
                    }
                }
                
            } catch (err) {
                console.log('Error details:', err);
                
                // Enhanced error logging
                if (err.response) {
                    console.log('Response status:', err.response.status);
                    if (err.response.data) {
                        console.log('Response data:', JSON.stringify(err.response.data, null, 2));
                    }
                    
                    if (err.response.status === 403) {
                        workitemStatus.Error = 'Permission error - check project permissions';
                    } else if (err.response.status === 401) {
                        workitemStatus.Error = 'Authentication error - token expired';
                    } else if (err.response.status === 409) {
                        workitemStatus.Error = 'File already exists or version conflict';
                    } else {
                        workitemStatus.Error = `API error: ${err.response.status}`;
                    }
                } else {
                    workitemStatus.Error = err.message || 'Unknown error';
                }
                
                workitemStatus.Status = 'Failed';
                global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                
                // Update tracker
                workitemTracker.failWorkitem(req.body.id, workitemStatus.Error);
                
                // Handle bulk processing failure
                if (bulkWorkitemInfo) {
                    bulkQueue.handleFileFailed(
                        bulkWorkitemInfo.file, 
                        bulkWorkitemInfo.bulkJob, 
                        new Error(workitemStatus.Error)
                    );
                }
            } finally {
                // Remove the workitem after it's done
                if (workitem) {
                    removeWorkitemFromList(workitem);
                }
                
                // Always ensure tracker is updated
                if (!workitemTracker.getWorkitem(req.body.id)) {
                    // If not already updated, remove it
                    workitemTracker.removeWorkitem(req.body.id);
                }
            }
        }, 2000); // 2 second delay to handle ngrok timing
        
    } else {
        // Report if Design Automation job was not successful
        workitemStatus.Status = 'Failed';
        workitemStatus.Error = `Design Automation process failed: ${req.body.status}`;
        console.log('Design Automation error:', req.body);
        
        // Update tracker
        workitemTracker.failWorkitem(req.body.id, workitemStatus.Error);
        
        // Handle bulk processing failure
        if (bulkWorkitemInfo) {
            bulkQueue.handleFileFailed(
                bulkWorkitemInfo.file, 
                bulkWorkitemInfo.bulkJob, 
                new Error(workitemStatus.Error)
            );
        } else {
            // Find and remove regular workitem
            const workitem = workitemList.find(item => item.workitemId === req.body.id);
            if (workitem) {
                removeWorkitemFromList(workitem);
            }
        }
        
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
    }
});

// Initialize global bulk workitems map
if (!global.bulkJobWorkitems) {
    global.bulkJobWorkitems = new Map();
}

// Helper function to properly remove workitem from list
function removeWorkitemFromList(workitem) {
    const index = workitemList.findIndex(item => item.workitemId === workitem.workitemId);
    if (index !== -1) {
        workitemList.splice(index, 1);
        console.log(`Removed workitem ${workitem.workitemId} from list. Remaining: ${workitemList.length}`);
    }
}

module.exports = router;
