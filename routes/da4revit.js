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

const {
    ItemsApi,
    VersionsApi,
} = require('forge-apis');

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

let router = express.Router();


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
/// upgrade revit file to specified version using Design Automation 
/// for Revit API
///////////////////////////////////////////////////////////////////////
router.post('/da4revit/v1/upgrader/files', async (req, res, next) => {
    const fileItemId   = req.body.fileItemId;
    const fileItemName = req.body.fileItemName;
    const inPlace = true;
    const targetVersion = req.body.targetVersion || "2023";

    const fileNameParts = fileItemName.split('.');
    const fileExtension = fileNameParts[fileNameParts.length-1].toLowerCase();

    if (fileExtension !== 'rvt' && fileExtension !== 'rfa' && fileExtension !== 'fte') {
        console.log('info: the file format is not supported');
        res.status(500).end('the file format is not supported');
        return;
    }

    if (fileItemId === '' || fileItemName === '') {
        res.status(500).end();
        return;
    }

    if (fileItemId === '#') {
        res.status(500).end('not supported item');
    } 

    const params = fileItemId.split('/');
    if( params.length < 3){
        res.status(500).end('selected item id has problem');
    }

    const resourceName = params[params.length - 2];
    if (resourceName !== 'items') {
        res.status(500).end('not supported item');
        return;
    }

    const resourceId = params[params.length - 1];
    const projectId = params[params.length - 3];

    console.log(`Setting up in-place upgrade with isNewVersion=true for file: ${fileItemName}`);

    try {
        // Check if file was already upgraded to this version
        const alreadyUpgraded = await isFileAlreadyUpgraded(
            projectId, 
            resourceId, 
            targetVersion, 
            req.oauth_client, 
            req.oauth_token
        );
        
        if (alreadyUpgraded) {
            console.log(`File ${fileItemName} already upgraded to ${targetVersion}`);
            res.status(200).json({
                "fileName": fileItemName,
                "status": "AlreadyUpgraded",
                "message": `File was already upgraded to ${targetVersion}`
            });
            return;
        }
        
        // Get parent folder
        const items = new ItemsApi();
        const folder = await items.getItemParentFolder(projectId, resourceId, req.oauth_client, req.oauth_token);
        
        // Get version info
        const versionInfo = await getLatestVersionInfo(projectId, resourceId, req.oauth_client, req.oauth_token);
        const inputStorageId = versionInfo.versionStorageId;
        
        // Create storage for upgraded file
        const storageInfo = await getNewCreatedStorageInfo(
            projectId, 
            folder.body.data.id, 
            fileItemName, // Keep the original name
            req.oauth_client, 
            req.oauth_token
        );
        
        // Create version body - passing target version for metadata
        const createVersionBody = createBodyOfPostVersion(
            resourceId,
            fileItemName, 
            storageInfo.StorageId,
            versionInfo.versionType,
            targetVersion
        );
        
        // Log the payload before sending
        logPayload('Version Creation Payload', createVersionBody);
        
        // Process upgrade
        const oauth = new OAuth(req.session);
        const oauth_client = oauth.get2LeggedClient();
        const oauth_token = await oauth_client.authenticate();
        
        let upgradeRes = await upgradeFile(
            inputStorageId, 
            storageInfo.StorageId, 
            projectId, 
            createVersionBody, 
            fileExtension, 
            req.oauth_token, 
            oauth_token,
            true 
        );
        
        console.log('Submitted the workitem: ' + upgradeRes.body.id);
        const upgradeInfo = {
            "fileName": fileItemName,
            "workItemId": upgradeRes.body.id,
            "workItemStatus": upgradeRes.body.status,
            "targetVersion": targetVersion
        };
        
        res.status(200).end(JSON.stringify(upgradeInfo));
    } catch (err) {
        console.log('get exception while upgrading the file')
        res.status(500).end(err);
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
// Fix for the callback handler in da4revit.js
router.post('/callback/designautomation', async (req, res, next) => {
    // Best practice is to acknowledge receipt immediately
    res.status(202).end();

    let workitemStatus = {
        'WorkitemId': req.body.id,
        'Status': "Processing"
    };
    
    if (req.body.status === 'success') {
        // Find the workitem that matches this callback
        const workitem = workitemList.find((item) => {
            return item.workitemId === req.body.id;
        });

        if (workitem === undefined) {
            console.log('The workitem: ' + req.body.id + ' to callback is not in the item list');
            return;
        }
        
        let index = workitemList.indexOf(workitem);
        workitemStatus.Status = 'Success';
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        console.log("Processing workitem: " + workitem.workitemId);
        console.log("Is new version flag: ", workitem.isNewVersion);

        try {
            // Create a new OAuth instance and properly set up the session with token info
            const oauth = new OAuth();
            
            // Use the token info we carefully stored in the workitem
            if (workitem.access_token_3Legged) {
                oauth._session = {
                    internal_token: workitem.access_token_3Legged.access_token,
                    refresh_token: workitem.access_token_3Legged.refresh_token,
                    expires_at: workitem.access_token_3Legged.expires_at
                };
                
                console.log("Session reconstructed with tokens from workitem");
            } else {
                console.log("No token information available in workitem");
                workitemStatus.Status = 'Failed';
                workitemStatus.Error = 'Missing authentication data';
                global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                return;
            }
            
            // Get a fresh token using the session we reconstructed
            console.log("Obtaining fresh token...");
            const credentials = await oauth.getInternalToken();
            
            if (!credentials) {
                console.log("Failed to get valid token");
                workitemStatus.Status = 'Failed';
                workitemStatus.Error = 'Authentication failed';
                global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
                return;
            }
            
            console.log("Valid token obtained, proceeding with API calls");
            
            // Extract project ID first (common to both cases)
            const projectId = workitem.projectId;
            if (!projectId) {
                throw new Error("Missing project ID in workitem");
            }
            
            // Initialize variables we'll extract from the workitem
            let fileItemId = null;
            let storageId = null;
            let fileName = null;
            let versionType = null;
            
            // Log the actual workitem data structure for debugging
            console.log("Workitem createVersionData structure:", 
                        JSON.stringify(workitem.createVersionData, null, 2));
            
            // Extract data differently based on whether this is a new version or new item
            if (workitem.isNewVersion === true) {
                console.log("Processing as new version");
                
                // For new version: get data from version relationships
                if (workitem.createVersionData && 
                    workitem.createVersionData.data && 
                    workitem.createVersionData.data.relationships) {
                    
                    // Get item ID
                    if (workitem.createVersionData.data.relationships.item && 
                        workitem.createVersionData.data.relationships.item.data) {
                        fileItemId = workitem.createVersionData.data.relationships.item.data.id;
                    }
                    
                    // Get storage ID
                    if (workitem.createVersionData.data.relationships.storage && 
                        workitem.createVersionData.data.relationships.storage.data) {
                        storageId = workitem.createVersionData.data.relationships.storage.data.id;
                    }
                }
                
                // Get filename and version type
                if (workitem.createVersionData && 
                    workitem.createVersionData.data && 
                    workitem.createVersionData.data.attributes) {
                    
                    fileName = workitem.createVersionData.data.attributes.name;
                    
                    if (workitem.createVersionData.data.attributes.extension) {
                        versionType = workitem.createVersionData.data.attributes.extension.type;
                    }
                }
            } else {
                console.log("Processing as new item");
                
                // For new item: most data comes from the 'included' array (first version)
                if (workitem.createVersionData && 
                    workitem.createVersionData.included && 
                    workitem.createVersionData.included.length > 0) {
                    
                    const firstVersion = workitem.createVersionData.included[0];
                    
                    // Get storage ID from included version
                    if (firstVersion.relationships && 
                        firstVersion.relationships.storage && 
                        firstVersion.relationships.storage.data) {
                        storageId = firstVersion.relationships.storage.data.id;
                    }
                    
                    // Get filename and version type from included version
                    if (firstVersion.attributes) {
                        fileName = firstVersion.attributes.name;
                        
                        if (firstVersion.attributes.extension) {
                            versionType = firstVersion.attributes.extension.type;
                        }
                    }
                }
                
                // For a new item, the parent folder ID is important
                if (workitem.createVersionData && 
                    workitem.createVersionData.data && 
                    workitem.createVersionData.data.relationships &&
                    workitem.createVersionData.data.relationships.parent &&
                    workitem.createVersionData.data.relationships.parent.data) {
                    
                    // Store folder ID (not used directly for API call but useful for logging)
                    const folderId = workitem.createVersionData.data.relationships.parent.data.id;
                    console.log("Parent folder ID:", folderId);
                }
            }
            
            // Log the extracted data for debugging
            console.log("Extracted data from workitem:");
            console.log("- Project ID:", projectId);
            console.log("- File Item ID:", fileItemId);
            console.log("- Storage ID:", storageId);
            console.log("- File Name:", fileName);
            console.log("- Version Type:", versionType);
            
            // Verify we have the minimum required data
            if (!projectId || !storageId || !fileName) {
                throw new Error(`Missing required data from workitem: projectId=${projectId}, storageId=${storageId}, fileName=${fileName}`);
            }
            
            // For version creation, we must have an item ID
            if (workitem.isNewVersion === true && !fileItemId) {
                throw new Error("Missing item ID required for version creation");
            }
            
            // Process using the direct API approach
            let version = null;
            
            try {
                console.log(`Creating ${workitem.isNewVersion ? 'new version' : 'new item'} with direct API`);
                
                // Choose endpoint based on operation type
                const apiEndpoint = workitem.isNewVersion === true 
                    ? `https://developer.api.autodesk.com/data/v1/projects/${projectId}/versions`
                    : `https://developer.api.autodesk.com/data/v1/projects/${projectId}/items`;
                
                console.log("Using API endpoint:", apiEndpoint);
                
                // Create API request body based on operation type
                const requestBody = workitem.isNewVersion === true
                    ? {
                        "jsonapi": { "version": "1.0" },
                        "data": {
                            "type": "versions",
                            "attributes": {
                                "name": fileName,
                                "extension": {
                                    "type": versionType,
                                    "version": "1.0"
                                }
                            },
                            "relationships": {
                                "item": {
                                    "data": {
                                        "type": "items",
                                        "id": fileItemId
                                    }
                                },
                                "storage": {
                                    "data": {
                                        "type": "objects",
                                        "id": storageId
                                    }
                                }
                            }
                        }
                    }
                    : workitem.createVersionData; // For new items, use the original payload
                
                // Log the request body for debugging
                console.log("API request body:", JSON.stringify(requestBody, null, 2));
                
                // Create request options
                const options = {
                    method: 'POST',
                    url: apiEndpoint,
                    headers: {
                        'Content-Type': 'application/vnd.api+json',
                        'Authorization': `Bearer ${credentials.access_token}`
                    },
                    body: JSON.stringify(requestBody)
                };
                
                // Make the request using the request library
                version = await new Promise((resolve, reject) => {
                    request(options, (error, response, body) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        
                        console.log('Direct API response status:', response.statusCode);
                        
                        let responseData;
                        try {
                            responseData = JSON.parse(body);
                            console.log('Response body:', JSON.stringify(responseData, null, 2));
                        } catch (e) {
                            console.log('Response is not JSON:', body);
                            responseData = body;
                        }
                        
                        if (response.statusCode >= 400) {
                            // If we get a conflict, try with a timestamp
                            if (response.statusCode === 409) {
                                console.log('Conflict detected, trying with timestamp...');
                                const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
                                const fileNameParts = fileName.split('.');
                                const extension = fileNameParts.pop();
                                const baseName = fileNameParts.join('.');
                                const newName = `${baseName}_${timestamp}.${extension}`;
                                
                                // Update options with new name
                                const updatedOptions = { ...options };
                                const updatedBody = JSON.parse(updatedOptions.body);
                                
                                // Update the name in the appropriate place based on operation type
                                if (workitem.isNewVersion === true) {
                                    updatedBody.data.attributes.name = newName;
                                } else {
                                    // For new item, update both main data and included version
                                    updatedBody.data.attributes.name = newName;
                                    if (updatedBody.included && updatedBody.included.length > 0) {
                                        updatedBody.included[0].attributes.name = newName;
                                    }
                                }
                                
                                updatedOptions.body = JSON.stringify(updatedBody);
                                
                                console.log('Retrying with name:', newName);
                                
                                // Try again with timestamp
                                request(updatedOptions, (err2, resp2, body2) => {
                                    if (err2) {
                                        reject(err2);
                                        return;
                                    }
                                    
                                    console.log('Retry status:', resp2.statusCode);
                                    
                                    if (resp2.statusCode >= 400) {
                                        reject({
                                            statusCode: resp2.statusCode,
                                            body: body2
                                        });
                                    } else {
                                        try {
                                            const data = JSON.parse(body2);
                                            resolve({
                                                statusCode: resp2.statusCode,
                                                body: data
                                            });
                                        } catch (e) {
                                            resolve({
                                                statusCode: resp2.statusCode,
                                                body: body2
                                            });
                                        }
                                    }
                                });
                            } else {
                                reject({
                                    statusCode: response.statusCode,
                                    body: responseData
                                });
                            }
                        } else {
                            resolve({
                                statusCode: response.statusCode,
                                body: responseData
                            });
                        }
                    });
                });
                
                console.log(`Successfully created ${workitem.isNewVersion ? 'new version' : 'new item'}!`);
            } catch (err) {
                console.log("Direct API failed:", err);
                throw err;
            }
            
            if (version === null || (version.statusCode !== 201 && version.statusCode !== 200)) {
                console.log(`Failed to create ${workitem.isNewVersion ? 'new version' : 'new item'}`);
                workitemStatus.Status = 'Failed';
                workitemStatus.Error = 'BIM360/ACC API call failed';
            } else {
                console.log(`Successfully created ${workitem.isNewVersion ? 'new version' : 'new item'}`);
                workitemStatus.Status = 'Completed';
            }
            
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        } catch (err) {
            console.log('Error details:', err);
            
            let errorDetail = 'Unknown error';
            
            if (err.statusCode) {
                errorDetail = `Status ${err.statusCode}: ${err.statusMessage || 'Unknown error'}`;
            }
            
            if (err.response) {
                console.log('Response status:', err.response.status);
                if (err.response.data) {
                    console.log('Response data:', JSON.stringify(err.response.data, null, 2));
                    errorDetail = JSON.stringify(err.response.data);
                }
            } else if (err.body) {
                errorDetail = JSON.stringify(err.body);
            } else if (err.message) {
                errorDetail = err.message;
            }
            
            workitemStatus.Status = 'Failed';
            workitemStatus.Error = `API Error: ${errorDetail}`;
            global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);
        } finally {
            workitemList.splice(index, 1);
        }
    } else {
        workitemStatus.Status = 'Failed';
        workitemStatus.Error = 'Design Automation process failed';
        global.MyApp.SocketIo.emit(SOCKET_TOPIC_WORKITEM, workitemStatus);

        console.log('Design Automation error:', req.body);
    }
    return;
});

module.exports = router;
