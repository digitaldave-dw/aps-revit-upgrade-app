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
const request = require("request");

const { designAutomation }= require('../../config');

const {
    ProjectsApi, 
    ItemsApi,
    StorageRelationshipsTarget,
    CreateStorageDataRelationships,
    CreateStorageDataAttributes,
    CreateStorageData,
    CreateStorage,
    CreateVersion,
    CreateVersionData,
    CreateVersionDataRelationships,
    CreateItemRelationshipsStorageData,
    CreateItemRelationshipsStorage,
    CreateVersionDataRelationshipsItem,
    CreateVersionDataRelationshipsItemData,

    StorageRelationshipsTargetData,
    BaseAttributesExtensionObject,
} = require('forge-apis');

const AUTODESK_HUB_BUCKET_KEY = 'wip.dm.prod';
var workitemList = [];


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function getWorkitemStatus(workItemId, access_token) {

    return new Promise(function (resolve, reject) {

        var options = {
            method: 'GET',
            url: designAutomation.endpoint +'workitems/'+ workItemId,
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Type': 'application/json'
            }
        };

        request(options, function (error, response, body) {
            if (error) {
                reject(err);
            } else {
                let resp;
                try {
                    resp = JSON.parse(body)
                } catch (e) {
                    resp = body
                }
                if (response.statusCode >= 400) {
                    console.log('error code: ' + response.statusCode + ' response message: ' + response.statusMessage);
                    reject({
                        statusCode: response.statusCode,
                        statusMessage: response.statusMessage
                    });
                } else {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: resp
                    });
                }
            }
        });
    });
}

///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function cancelWorkitem(workItemId, access_token) {

    return new Promise(function (resolve, reject) {

        var options = {
            method: 'DELETE',
            url: designAutomation.endpoint +'workitems/'+ workItemId,
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Type': 'application/json'
            }
        };

        request(options, function (error, response, body) {
            if (error) {
                reject(err);
            } else {
                let resp;
                try {
                    resp = JSON.parse(body)
                } catch (e) {
                    resp = body
                }
                if (response.statusCode >= 400) {
                    console.log('error code: ' + response.statusCode + ' response message: ' + response.statusMessage);
                    reject({
                        statusCode: response.statusCode,
                        statusMessage: response.statusMessage
                    });
                } else {
                    resolve({
                        statusCode: response.statusCode,
                        headers: response.headers,
                        body: resp
                    });
                }
            }
        });
    });
}



///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function upgradeFile(inputUrl, outputUrl, projectId, createVersionData, fileExtension, access_token_3Legged, access_token_2Legged, isNewVersion = false) {
    return new Promise(function (resolve, reject) {
        // Create workitem body
        console.log(`upgradeFile called with isNewVersion=${isNewVersion}`);
        console.log(`createVersionData.data.type = ${createVersionData.data.type}`);
        const workitemBody = createPostWorkitemBody(inputUrl, outputUrl, fileExtension, access_token_3Legged.access_token);
        
        if (workitemBody === null) {
            reject('workitem request body is null');
            return;
        }
        
        // Create and execute workitem
        var options = {
            method: 'POST',
            url: designAutomation.endpoint + 'workitems',
            headers: {
                Authorization: 'Bearer ' + access_token_2Legged.access_token,
                'Content-Type': 'application/json'
            },
            body: workitemBody,
            json: true
        };
        
        request(options, function (error, response, body) {
            if (error) {
                reject(error);
                return;
            }
            
            let resp;
            try {
                resp = JSON.parse(body);
            } catch (e) {
                resp = body;
            }
            
            // Force isNewVersion to true if createVersionData.data.type is "versions"
            const isVersionOperation = isNewVersion === true || 
                                      (createVersionData && 
                                       createVersionData.data && 
                                       createVersionData.data.type === 'versions');
            
            console.log(`Storing workitem with isNewVersion=${isVersionOperation}, dataType=${createVersionData.data.type}`);
            
            workitemList.push({
                workitemId: resp.id,
                projectId: projectId,
                createVersionData: createVersionData,
                access_token_3Legged: {
                    access_token: access_token_3Legged.access_token,
                    refresh_token: access_token_3Legged.refresh_token,
                    expires_at: access_token_3Legged.expires_at
                },
                // Critical change: Make sure this is set correctly
                isNewVersion: isVersionOperation,
                operationType: createVersionData.data.type, // Store the data type as well
                fileItemId: createVersionData.data.relationships && 
                           createVersionData.data.relationships.item && 
                           createVersionData.data.relationships.item.data ? 
                           createVersionData.data.relationships.item.data.id : null
            });
            
            if (response.statusCode >= 400) {
                console.log('Error:', response.statusCode, response.statusMessage);
                reject({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage
                });
            } else {
                resolve({
                    statusCode: response.statusCode,
                    headers: response.headers,
                    body: resp
                });
            }
        });
    });
}




///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
async function getLatestVersionInfo(projectId, fileId, oauth_client, oauth_token) {
    if (projectId === '' || fileId === '') {
        console.log('failed to get lastest version of the file');
        return null;
    }

    // get the storage of the input item version
    const versionItem = await getLatestVersion(projectId, fileId, oauth_client, oauth_token);
    if (versionItem === null) {
        console.log('failed to get lastest version of the file');
        return null;
    }
    return {
        "versionStorageId": versionItem.relationships.storage.data.id,
        "versionType": versionItem.attributes.extension.type
    };
}


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
async function getLatestVersion(projectId, itemId, oauthClient, credentials) {
    const items = new ItemsApi();
    const versions = await items.getItemVersions(projectId, itemId, {}, oauthClient, credentials);
    if(versions === null || versions.statusCode !== 200 ){
        console.log('failed to get the versions of file');
        res.status(500).end('failed to get the versions of file');
        return null;
    }
    return versions.body.data[0];
}


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
async function getNewCreatedStorageInfo(projectId, folderId, fileName, oauth_client, oauth_token) {

    // create body for Post Storage request
    let createStorageBody = createBodyOfPostStorage(folderId, fileName);

    const project = new ProjectsApi();
    let storage = await project.postStorage(projectId, createStorageBody, oauth_client, oauth_token);
    if (storage === null || storage.statusCode !== 201) {
        console.log('failed to create a storage.');
        return null;
    }
    return {
        "StorageId": storage.body.data.id
    };
}


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function createBodyOfPostItem( fileName, folderId, storageId, itemType, versionType){
    const body = 
    {
        "jsonapi":{
            "version":"1.0"
        },
        "data":{
            "type":"items",
            "attributes":{
                "name":fileName,
                "extension":{
                    "type":itemType,
                    "version":"1.0"
                }
            },
            "relationships":{
                "tip":{
                    "data":{
                        "type":"versions",
                        "id":"1"
                    }
                },
                "parent":{
                    "data":{
                        "type":"folders",
                        "id":folderId
                    }
                }
            }
        },
        "included":[
            {
                "type":"versions",
                "id":"1",
                "attributes":{
                    "name":fileName,
                    "extension":{
                        "type":versionType,
                        "version":"1.0"
                    }
                },
                "relationships":{
                    "storage":{
                        "data":{
                            "type":"objects",
                            "id":storageId
                        }
                    }
                }
            }
        ]
    };
    return body;
}



///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function createBodyOfPostStorage(folderId, fileName) {
    // create a new storage for the ouput item version
    let createStorage = new CreateStorage();
    let storageRelationshipsTargetData = new StorageRelationshipsTargetData("folders", folderId);
    let storageRelationshipsTarget = new StorageRelationshipsTarget;
    let createStorageDataRelationships = new CreateStorageDataRelationships();
    let createStorageData = new CreateStorageData();
    let createStorageDataAttributes = new CreateStorageDataAttributes();

    createStorageDataAttributes.name = fileName;
    storageRelationshipsTarget.data = storageRelationshipsTargetData;
    createStorageDataRelationships.target = storageRelationshipsTarget;
    createStorageData.relationships = createStorageDataRelationships;
    createStorageData.type = 'objects';
    createStorageData.attributes = createStorageDataAttributes;
    createStorage.data = createStorageData;
    
    return createStorage;
}



///////////////////////////////////////////////////////////////////////
// /
// /
///////////////////////////////////////////////////////////////////////
// Modified createBodyOfPostVersion function for da4revitImp.js
// function createBodyOfPostVersion(fileId, fileName, storageId, versionType, targetVersion) {
//     // Create relationships to the item and storage
//     let createVersionDataRelationshipsItem = new CreateVersionDataRelationshipsItem();
//     let createVersionDataRelationshipsItemData = new CreateVersionDataRelationshipsItemData();
//     createVersionDataRelationshipsItemData.type = "items";
//     createVersionDataRelationshipsItemData.id = fileId;
//     createVersionDataRelationshipsItem.data = createVersionDataRelationshipsItemData;

//     let createItemRelationshipsStorage = new CreateItemRelationshipsStorage();
//     let createItemRelationshipsStorageData = new CreateItemRelationshipsStorageData();
//     createItemRelationshipsStorageData.type = "objects";
//     createItemRelationshipsStorageData.id = storageId;
//     createItemRelationshipsStorage.data = createItemRelationshipsStorageData;

//     let createVersionDataRelationships = new CreateVersionDataRelationships();
//     createVersionDataRelationships.item = createVersionDataRelationshipsItem;
//     createVersionDataRelationships.storage = createItemRelationshipsStorage;

//     // Create extension object with upgrade metadata
//     let baseAttributesExtensionObject = new BaseAttributesExtensionObject();
//     baseAttributesExtensionObject.type = versionType;
//     baseAttributesExtensionObject.version = "1.0";
    
//     // Add upgrade metadata without modifying filename
//     if (targetVersion) {
//         baseAttributesExtensionObject.data = {
//             upgradeInfo: {
//                 targetVersion: targetVersion,
//                 upgradeDate: new Date().toISOString(),
//                 processedBy: "APS Revit Upgrader"
//             }
//         };
//     }

//     // Create attributes with original filename
//     let createStorageDataAttributes = new CreateStorageDataAttributes();
//     createStorageDataAttributes.name = fileName; // Keep original filename
//     createStorageDataAttributes.extension = baseAttributesExtensionObject;

//     // Create version data structure
//     let createVersionData = new CreateVersionData();
//     createVersionData.type = "versions";
//     createVersionData.attributes = createStorageDataAttributes;
//     createVersionData.relationships = createVersionDataRelationships;

//     // Final version structure without 'included' array
//     let createVersion = new CreateVersion();
//     createVersion.data = createVersionData;

//     return createVersion;
    
// }

function createBodyOfPostVersion(fileId, fileName, storageId, versionType, targetVersion) {
    // Create a direct JSON structure instead of using Forge API classes
    // This avoids any unexpected payload transformations
    
    // Add upgrade metadata
    const extensionData = targetVersion ? {
        upgradeInfo: {
            targetVersion: targetVersion,
            upgradeDate: new Date().toISOString(),
            processedBy: "APS Revit Upgrader"
        }
    } : {};
    
    // Create the exact JSON structure required by the API
    const versionBody = {
        "jsonapi": {
            "version": "1.0"
        },
        "data": {
            "type": "versions",
            "attributes": {
                "name": fileName,
                "extension": {
                    "type": versionType,
                    "version": "1.0",
                    "data": targetVersion ? {
                        "upgradeInfo": {
                            "targetVersion": targetVersion,
                            "upgradeDate": new Date().toISOString(),
                            "processedBy": "APS Revit Upgrader"
                        }
                    } : {}
                }
            },
            "relationships": {
                "item": {
                    "data": {
                        "type": "items",
                        "id": fileId
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
    };
    
    // Log the payload for debugging
    console.log('Version payload:', JSON.stringify(versionBody, null, 2));
    
    return versionBody;
}


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function createPostWorkitemBody(inputUrl, outputUrl, fileExtension, access_token) {

    let body = null;
    switch (fileExtension) {
        case 'rvt':
            body = {
                activityId:  designAutomation.nickname + '.'+designAutomation.activity_name+'+'+designAutomation.appbundle_activity_alias,
                arguments: {
                    rvtFile: {
                        url: inputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    resultrvt: {
                        verb: 'put',
                        url: outputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    onComplete: {
                        verb: "post",
                        url: designAutomation.webhook_url
                    }
                }
            };
            break;
        case 'rfa':
            body = {
                activityId:  designAutomation.nickname + '.'+designAutomation.activity_name+'+'+designAutomation.appbundle_activity_alias,
                arguments: {
                    rvtFile: {
                        url: inputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    resultrfa: {
                        verb: 'put',
                        url: outputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    onComplete: {
                        verb: "post",
                        url: designAutomation.webhook_url
                    }
                }
            };
            break;
        case 'rte':
            body = {
                activityId:  designAutomation.nickname + '.'+designAutomation.activity_name+'+'+designAutomation.appbundle_activity_alias,
                arguments: {
                    rvtFile: {
                        url: inputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    resultrte: {
                        verb: 'put',
                        url: outputUrl,
                        Headers: {
                            Authorization: 'Bearer ' + access_token
                        },
                    },
                    onComplete: {
                        verb: "post",
                        url: designAutomation.webhook_url
                    }
                }
            };
            break;
    }
    return body;
}

async function isFileAlreadyUpgraded(projectId, fileId, targetVersion, oauthClient, credentials) {
    try {
        const items = new ItemsApi();
        const versions = await items.getItemVersions(projectId, fileId, {}, oauthClient, credentials);
        
        if (!versions || versions.statusCode !== 200) {
            console.log('Failed to get versions for file check');
            return false;
        }
        
        for (const version of versions.body.data) {
            if (version.attributes.extension && 
                version.attributes.extension.data && 
                version.attributes.extension.data.upgradeInfo && 
                version.attributes.extension.data.upgradeInfo.targetVersion === targetVersion) {
                console.log(`File ${fileId} already upgraded to ${targetVersion}`);
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.log('Error checking for upgraded file:', error);
        return false;
    }
}

function createNewVersionDirectApi(projectId, itemId, storageId, fileName, versionType, accessToken) {
    return new Promise((resolve, reject) => {
        const payload = {
            "jsonapi": {
                "version": "1.0"
            },
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
                            "id": itemId
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
        };

        console.log('Creating version with direct API call');
        console.log('Project ID:', projectId);
        console.log('Item ID:', itemId);
        console.log('Storage ID:', storageId);
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const options = {
            method: 'POST',
            url: `https://developer.api.autodesk.com/data/v1/projects/${projectId}/versions`,
            headers: {
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(payload)
        };

        request(options, (error, response, body) => {
            if (error) {
                console.log('Direct API call error:', error);
                reject(error);
                return;
            }

            console.log('Direct API response status:', response.statusCode);
            
            let responseData;
            try {
                responseData = JSON.parse(body);
                console.log('Direct API response body:', JSON.stringify(responseData, null, 2));
            } catch (e) {
                console.log('Response is not JSON:', body);
                responseData = body;
            }

            if (response.statusCode >= 400) {
                console.log('Direct API error:', response.statusCode, response.statusMessage);
                reject({
                    statusCode: response.statusCode,
                    statusMessage: response.statusMessage,
                    body: responseData
                });
            } else {
                console.log('Version created successfully!');
                resolve({
                    statusCode: response.statusCode,
                    headers: response.headers,
                    body: responseData
                });
            }
        });
    });
}

async function checkFileExists(projectId, folderId, fileName, oauth_client, oauth_token) {
    const folders = new FoldersApi();
    const contents = await folders.getFolderContents(projectId, folderId, {}, oauth_client, oauth_token);
    
    return contents.body.data.some(item => 
        item.attributes.displayName === fileName || item.attributes.name === fileName
    );
}

function logPayload(title, payload) {
    console.log(`------ ${title} ------`);
    console.log(JSON.stringify(payload, null, 2));
    console.log('------------------------');
    return payload; 
}


module.exports = 
{ 
    getWorkitemStatus, 
    cancelWorkitem, 
    upgradeFile, 
    getLatestVersionInfo, 
    getNewCreatedStorageInfo, 
    createBodyOfPostVersion,
    createBodyOfPostItem,
    isFileAlreadyUpgraded,
    logPayload,
    createNewVersionDirectApi,
    checkFileExists,
    workitemList 
};
