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
        this.maxConcurrent = 5;      // Max concurrent workitems (adjust based on your DA limits)
        this.batchId = 0;           // Unique identifier for bulk operations
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
            failedFiles: 0
        };

        this.queue.push(bulkJob);
        console.log(`Added bulk job ${batchId} with ${files.length} files to queue`);
        
        // Start processing if not already running
        this.processQueue();
        
        return batchId;
    }

    // Process the queue
    async processQueue() {
        if (this.queue.length === 0) return;

        // Process jobs one by one
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
    }

    // Process a single bulk job
    async processBulkJob(bulkJob) {
        console.log(`Processing bulk job ${bulkJob.batchId} with ${bulkJob.totalFiles} files`);
        
        const pendingFiles = bulkJob.files.filter(f => f.status === 'queued');
        
        while (pendingFiles.length > 0) {
            // Get files we can process (up to maxConcurrent)
            const availableSlots = this.maxConcurrent - this.processing.size;
            if (availableSlots <= 0) {
                // Wait for some to complete
                await this.waitForSlot();
                continue;
            }

            // Take files for this batch
            const filesToProcess = pendingFiles.splice(0, Math.min(availableSlots, pendingFiles.length));
            
            // Start processing these files
            const processingPromises = filesToProcess.map(file => 
                this.processFile(file, bulkJob.options)
                    .then(result => this.handleFileComplete(file, bulkJob, result))
                    .catch(error => this.handleFileError(file, bulkJob, error))
            );

            // Don't wait for completion, continue processing more
            Promise.allSettled(processingPromises);
            
            // Update progress
            this.emitProgress(bulkJob);
            
            // Brief pause to avoid overwhelming the API
            await this.sleep(1000);
        }

        // Wait for all files in this job to complete
        while (bulkJob.completedFiles + bulkJob.failedFiles < bulkJob.totalFiles) {
            await this.sleep(2000);
            this.emitProgress(bulkJob);
        }
    }

    // Process a single file
    async processFile(file, options) {
        file.status = 'processing';
        file.attempts++;
        
        const processingKey = `${file.fileItemId}_${Date.now()}`;
        this.processing.set(processingKey, file);

        try {
            console.log(`Processing file: ${file.fileItemName} (attempt ${file.attempts})`);
            
            // Get file information
            const params = file.fileItemId.split('/');
            const resourceId = params[params.length - 1];
            const projectId = params[params.length - 3];

            // Create storage and version data
            const items = new ItemsApi();
            const folder = await items.getItemParentFolder(projectId, resourceId, options.oauth_client, options.oauth_token);
            
            const storageInfo = await getNewCreatedStorageInfo(
                projectId, 
                folder.body.data.id, 
                file.fileItemName, 
                options.oauth_client, 
                options.oauth_token
            );

            const versionInfo = await getLatestVersionInfo(projectId, resourceId, options.oauth_client, options.oauth_token);
            const inputStorageId = versionInfo.versionStorageId;

            const createVersionBody = createBodyOfPostVersion(
                resourceId,
                file.fileItemName, 
                storageInfo.StorageId,
                versionInfo.versionType,
                options.targetVersion
            );

            // Ensure correct type for version creation
            if (createVersionBody.data.type !== "versions") {
                createVersionBody.data.type = "versions";
            }

            // Get file extension
            const fileNameParts = file.fileItemName.split('.');
            const fileExtension = fileNameParts[fileNameParts.length-1].toLowerCase();

            // Submit to Design Automation
            const upgradeRes = await upgradeFile(
                inputStorageId, 
                storageInfo.StorageId, 
                projectId, 
                createVersionBody, 
                fileExtension, 
                options.oauth_token, 
                options.oauth_token_2legged,
                true // isNewVersion = true
            );

            this.processing.delete(processingKey);
            
            return {
                success: true,
                workItemId: upgradeRes.body.id,
                workItemStatus: upgradeRes.body.status
            };

        } catch (error) {
            this.processing.delete(processingKey);
            throw error;
        }
    }

    // Handle successful file completion
    handleFileComplete(file, bulkJob, result) {
        file.status = 'completed';
        file.workItemId = result.workItemId;
        file.workItemStatus = result.workItemStatus;
        file.completedAt = new Date();
        
        bulkJob.completedFiles++;
        this.completed.set(file.fileItemId, file);
        
        console.log(`File completed: ${file.fileItemName} (${bulkJob.completedFiles}/${bulkJob.totalFiles})`);
    }

    // Handle file processing error
    async handleFileError(file, bulkJob, error) {
        console.log(`File processing error: ${file.fileItemName}`, error.message);
        
        if (file.attempts < file.maxAttempts) {
            // Retry after delay
            file.status = 'queued';
            await this.sleep(5000); // Wait 5 seconds before retry
            return;
        }
        
        // Max attempts reached
        file.status = 'failed';
        file.error = error.message;
        file.failedAt = new Date();
        
        bulkJob.failedFiles++;
        this.failed.set(file.fileItemId, file);
        
        console.log(`File failed permanently: ${file.fileItemName}`);
    }

    // Wait for processing slot to become available
    async waitForSlot() {
        while (this.processing.size >= this.maxConcurrent) {
            await this.sleep(2000);
        }
    }

    // Emit progress updates via WebSocket
    emitProgress(bulkJob, isComplete = false) {
        const progress = {
            batchId: bulkJob.batchId,
            totalFiles: bulkJob.totalFiles,
            completedFiles: bulkJob.completedFiles,
            failedFiles: bulkJob.failedFiles,
            processingFiles: this.processing.size,
            queuedFiles: bulkJob.files.filter(f => f.status === 'queued').length,
            isComplete,
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
            processingFiles: job.files.filter(f => f.status === 'processing').length,
            queuedFiles: job.files.filter(f => f.status === 'queued').length,
            files: job.files
        };
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
/// NEW: Bulk upgrade multiple files from a folder
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/bulk', async (req, res, next) => {
    const { folderId, projectId, targetVersion = "2023", supportedTypes = ['rvt', 'rfa', 'rte'] } = req.body;

    if (!folderId || !projectId) {
        return res.status(400).json({ error: 'folderId and projectId are required' });
    }

    try {
        console.log('Starting bulk processing for:', { projectId, folderId, targetVersion, supportedTypes });

        // Get folder contents
        const folders = new FoldersApi();
        const contents = await folders.getFolderContents(projectId, folderId, {}, req.oauth_client, req.oauth_token);
        
        // Filter for supported Revit files
        const revitFiles = contents.body.data.filter(item => {
            if (item.type !== 'items') return false;
            
            const fileName = item.attributes.displayName || item.attributes.name;
            if (!fileName) return false;
            
            const extension = fileName.split('.').pop().toLowerCase();
            
            // Check if extension is in supported types
            return supportedTypes.includes(extension);
        });

        if (revitFiles.length === 0) {
            return res.status(404).json({ 
                error: 'No supported Revit files found in folder',
                supportedExtensions: supportedTypes
            });
        }

        console.log(`Found ${revitFiles.length} Revit files for bulk processing`);

        // Prepare files for queue
        const filesToProcess = revitFiles.map(item => ({
            fileItemId: item.links.self.href,
            fileItemName: item.attributes.displayName || item.attributes.name,
            projectId: projectId,
            itemId: item.id
        }));

        // Get 2-legged token for Design Automation
        const oauth = new OAuth(req.session);
        const oauth_client_2legged = oauth.get2LeggedClient();
        const oauth_token_2legged = await oauth_client_2legged.authenticate();

        // Add to processing queue
        const batchId = bulkQueue.addBulkJob(filesToProcess, {
            targetVersion,
            oauth_client: req.oauth_client,
            oauth_token: req.oauth_token,
            oauth_token_2legged
        });

        res.json({
            success: true,
            batchId,
            totalFiles: filesToProcess.length,
            message: `Started bulk processing of ${filesToProcess.length} files`,
            files: filesToProcess.map(f => f.fileItemName)
        });

    } catch (err) {
        console.log('Error in bulk processing:', err);
        res.status(500).json({ 
            error: 'Failed to start bulk processing',
            details: err.message 
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
    const targetVersion = req.body.targetVersion || "2023";

    // ... existing validation code ...

    const params = fileItemId.split('/');
    const resourceId = params[params.length - 1];
    const projectId = params[params.length - 3];

    console.log(`🚀 Starting upgrade: ${fileItemName} → ${targetVersion}`);

    try {
        // Get necessary info
        const items = new ItemsApi();
        const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, req.oauth_token);
        const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, req.oauth_token);
        const storageInfo = await getNewCreatedStorageInfo(projectId, folder.body.data.id, fileItemName, req.oauth_client, req.oauth_token);
        
        // FIXED: Use the corrected version creation function
        const createVersionBody = createBodyOfPostVersion(
            resourceId,                // fileId
            fileItemName,             // fileName
            storageInfo.StorageId,    // storageId
            versionInfo.versionType,  // versionType
            targetVersion            // targetVersion
        );
        
        // Ensure correct type
        createVersionBody.data.type = "versions";
        
        // Submit workitem
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();
        const oauth_token = await oauth_client.authenticate();
        
        console.log(`📤 Submitting to DA: ${fileItemName}`);
        console.log(`📡 Webhook: ${designAutomation.webhook_url}`);
        
        let upgradeRes = await upgradeFile(
            versionInfo.versionStorageId,  // input
            storageInfo.StorageId,         // output
            projectId,
            createVersionBody,             // FIXED payload
            fileExtension,
            req.oauth_token,
            oauth_token,
            true                          // isNewVersion = true
        );
        
        console.log(`✅ Workitem submitted: ${upgradeRes.body.id}`);
        
        res.status(200).json({
            "fileName": fileItemName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status,
            "targetVersion": targetVersion
        });
        
    } catch (err) {
        console.log('❌ Upload error:', err.message);
        res.status(500).json({
            error: 'Failed to upgrade file',
            details: err.message
        });
    }
});


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files/:source_file_url/folders/:destinate_folder_url', async (req, res, next) => {
    const sourceFileUrl = (req.params.source_file_url); 
    const destinateFolderUrl = (req.params.destinate_folder_url);
    if (sourceFileUrl === '' || destinateFolderUrl === '') {
        res.status(400).end('make sure sourceFile and destinateFolder have correct value');
        return;
    }
    const sourceFileParams = sourceFileUrl.split('/');
    const destinateFolderParams = destinateFolderUrl.split('/');
    if (sourceFileParams.length < 3 || destinateFolderParams.length < 3) {
        console.log('info: the url format is not correct');
        res.status(400).end('the url format is not correct');
        return;
    }

    const sourceFileType = sourceFileParams[sourceFileParams.length - 2];
    const destinateFolderType = destinateFolderParams[destinateFolderParams.length - 2];
    if (sourceFileType !== 'items' || destinateFolderType !== 'folders') {
        console.log('info: not supported item');
        res.status(400).end('not supported item');
        return;
    }

    const sourceFileId = sourceFileParams[sourceFileParams.length - 1];
    const sourceProjectId = sourceFileParams[sourceFileParams.length - 3];

    const destinateFolderId = destinateFolderParams[destinateFolderParams.length - 1];
    const destinateProjectId = destinateFolderParams[destinateFolderParams.length - 3];

    try {
        ////////////////////////////////////////////////////////////////////////////////
        // get the storage of the input item version
        const versionInfo = await getLatestVersionInfo(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (versionInfo === null) {
            console.log('error: failed to get lastest version of the file');
            res.status(500).end('failed to get lastest version of the file');
            return;
        }
        const inputStorageId = versionInfo.versionStorageId;

        const items = new ItemsApi();
        const sourceFile = await items.getItem(sourceProjectId, sourceFileId, req.oauth_client, req.oauth_token);
        if (sourceFile === null || sourceFile.statusCode !== 200) {
            console.log('error: failed to get the current file item.');
            res.status(500).end('failed to get the current file item');
            return;
        }
        const fileName = sourceFile.body.data.attributes.displayName;
        const itemType = sourceFile.body.data.attributes.extension.type;

        const fileParams = fileName.split('.');
        const fileExtension = fileParams[fileParams.length-1].toLowerCase();
        if( fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte'){
            console.log('info: the file format is not supported');
            res.status(500).end('the file format is not supported');
            return;
        }
    
        ////////////////////////////////////////////////////////////////////////////////
        // create a new storage for the ouput item version
        const storageInfo = await getNewCreatedStorageInfo(destinateProjectId, destinateFolderId, fileName, req.oauth_client, req.oauth_token);
        if (storageInfo === null) {
            console.log('error: failed to create the storage');
            res.status(500).end('failed to create the storage');
            return;
        }

        const createFirstVersionBody = createBodyOfPostItem(fileName, destinateFolderId, storageInfo.StorageId, itemType, versionInfo.versionType)
        if (createFirstVersionBody === null) {
            console.log('failed to create body of Post Item');
            res.status(500).end('failed to create body of Post Item');
            return;
        }

        
        ////////////////////////////////////////////////////////////////////////////////
        // use 2 legged token for design automation
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();;
        const oauth_token = await oauth_client.authenticate();
        let upgradeRes = await upgradeFile(inputStorageId, storageInfo.StorageId, destinateProjectId, createFirstVersionBody,fileExtension, req.oauth_token, oauth_token);
        if (upgradeRes === null || upgradeRes.statusCode !== 200) {
            console.log('failed to upgrade the revit file');
            res.status(500).end('failed to upgrade the revit file');
            return;
        }
        console.log('Submitted the workitem: '+ upgradeRes.body.id);
        const upgradeInfo = {
            "fileName": fileName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status
        };
        res.status(200).end(JSON.stringify(upgradeInfo));

    } catch (err) {
        console.log('get exception while upgrading the file:', err);
        
        if (typeof err === 'object') {
            if (err.statusCode) {
                return res.status(err.statusCode).json({
                    error: err.statusMessage || 'Unknown error',
                    details: err
                });
            } else {
                return res.status(500).json({
                    error: err.message || 'Unknown error'
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


///////////////////////////////////////////////////////////////////////
/// Handles the callback from Design Automation after job completion
///////////////////////////////////////////////////////////////////////
router.post('/callback/designautomation', async (req, res, next) => {
    // Acknowledge immediately
    res.status(202).end();

    const workitemId = req.body.id;
    const status = req.body.status;
    
    console.log(`🔔 Webhook received: ${workitemId} - ${status}`);

    let workitemStatus = {
        'WorkitemId': workitemId,
        'Status': "Processing"
    };
    
    if (status === 'success') {
        // Import the helper function
        const { findWorkitemById } = require('./common/da4revitImp');
        const workitem = findWorkitemById(workitemId);

        if (!workitem) {
            console.log(`❌ Workitem ${workitemId} not found in tracking list`);
            workitemStatus.Status = 'Failed';
            workitemStatus.Error = 'Workitem not found';
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
            return;
        }
        
        let index = workitemList.indexOf(workitem);
        workitemStatus.Status = 'Success';
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        
        console.log(`🔄 Processing workitem: ${workitem.workitemId}`);

        try {
            // Reconstruct OAuth session
            const oauth = new OAuth();
            oauth._session = {
                internal_token: workitem.access_token_3Legged.access_token,
                refresh_token: workitem.access_token_3Legged.refresh_token,
                expires_at: workitem.access_token_3Legged.expires_at
            };
            
            const credentials = await oauth.getInternalToken();
            if (!credentials) {
                throw new Error('Failed to get credentials');
            }
            
            const oauth_client = oauth.getClient();
            
            // Create new version (this is the core functionality)
            let result = null;
            const isVersionOperation = workitem.isNewVersion || 
                (workitem.createVersionData?.data?.type === 'versions');
            
            if (isVersionOperation) {
                console.log('✅ Creating new VERSION');
                const versions = new VersionsApi();
                
                // Ensure correct type
                if (workitem.createVersionData.data.type !== 'versions') {
                    workitem.createVersionData.data.type = 'versions';
                }
                
                result = await versions.postVersion(
                    workitem.projectId,
                    workitem.createVersionData,
                    oauth_client,
                    credentials
                );
            } else {
                console.log('✅ Creating new ITEM');
                const items = new ItemsApi();
                result = await items.postItem(
                    workitem.projectId,
                    workitem.createVersionData,
                    oauth_client,
                    credentials
                );
            }
            
            if (result && (result.statusCode === 201 || result.statusCode === 200)) {
                console.log('🎉 Successfully created new version/item');
                workitemStatus.Status = 'Completed';
            } else {
                throw new Error('API call failed');
            }
            
        } catch (error) {
            console.log('❌ Error in callback:', error.message);
            workitemStatus.Status = 'Failed';
            workitemStatus.Error = error.message;
        } finally {
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
            
            // Clean up
            if (index >= 0) {
                workitemList.splice(index, 1);
                console.log(`🧹 Cleaned up workitem ${workitemId}`);
            }
        }
        
    } else {
        console.log(`❌ Design Automation failed: ${workitemId}`);
        workitemStatus.Status = 'Failed';
        workitemStatus.Error = `DA failed: ${status}`;
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
    }
});

module.exports = router;
