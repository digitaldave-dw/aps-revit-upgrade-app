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

// Enhanced workitem tracking for bulk operations
class WorkitemTracker {
    constructor() {
        this.activeWorkitems = new Map();
        this.completedWorkitems = new Map();
        this.failedWorkitems = new Map();
    }

    addWorkitem(workitemId, data) {
        this.activeWorkitems.set(workitemId, {
            ...data,
            createdAt: new Date(),
            status: 'active'
        });
    }

    completeWorkitem(workitemId, result) {
        const workitem = this.activeWorkitems.get(workitemId);
        if (workitem) {
            workitem.completedAt = new Date();
            workitem.result = result;
            workitem.status = 'completed';
            this.completedWorkitems.set(workitemId, workitem);
            this.activeWorkitems.delete(workitemId);
        }
    }

    failWorkitem(workitemId, error) {
        const workitem = this.activeWorkitems.get(workitemId);
        if (workitem) {
            workitem.failedAt = new Date();
            workitem.error = error;
            workitem.status = 'failed';
            this.failedWorkitems.set(workitemId, workitem);
            this.activeWorkitems.delete(workitemId);
        }
    }

    getActiveCount() {
        return this.activeWorkitems.size;
    }

    getWorkitem(workitemId) {
        return this.activeWorkitems.get(workitemId) || 
               this.completedWorkitems.get(workitemId) || 
               this.failedWorkitems.get(workitemId);
    }
}

const workitemTracker = new WorkitemTracker();

///////////////////////////////////////////////////////////////////////
/// Get workitem status
///////////////////////////////////////////////////////////////////////
function getWorkitemStatus(workItemId, access_token) {
    return new Promise(function (resolve, reject) {
        var options = {
            method: 'GET',
            url: designAutomation.endpoint + 'workitems/' + workItemId,
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Type': 'application/json'
            }
        };

        request(options, function (error, response, body) {
            if (error) {
                reject(error);
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
/// Cancel workitem
///////////////////////////////////////////////////////////////////////
function cancelWorkitem(workItemId, access_token) {
    return new Promise(function (resolve, reject) {
        var options = {
            method: 'DELETE',
            url: designAutomation.endpoint + 'workitems/' + workItemId,
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Type': 'application/json'
            }
        };

        request(options, function (error, response, body) {
            if (error) {
                reject(error);
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
/// Enhanced upgrade file function with better error handling and queue management
///////////////////////////////////////////////////////////////////////
function upgradeFile(inputUrl, outputUrl, projectId, createVersionData, fileExtension, access_token_3Legged, access_token_2Legged, isNewVersion = false) {
    return new Promise(function (resolve, reject) {
        // Validate required parameters
        if (!inputUrl || !outputUrl || !projectId || !createVersionData) {
            return reject(new Error('Missing required parameters for upgradeFile'));
        }

        console.log(`upgradeFile called with parameters:
            - isNewVersion=${isNewVersion}
            - createVersionData.data.type=${createVersionData.data.type}
            - fileExtension=${fileExtension}
            - projectId=${projectId}
            - activeWorkitems=${workitemTracker.getActiveCount()}`);

        // Check if we're approaching DA limits
        if (workitemTracker.getActiveCount() >= 5) {
            return reject(new Error('Maximum concurrent workitems reached. Please wait for some to complete.'));
        }

        // Ensure createVersionData integrity
        if (isNewVersion === true && createVersionData.data.type !== "versions") {
            console.warn("WARNING: Correcting inconsistent data - isNewVersion=true but data.type is not 'versions'");
            createVersionData.data.type = "versions";
        }

        const workitemBody = createPostWorkitemBody(inputUrl, outputUrl, fileExtension, access_token_3Legged.access_token);
        if (workitemBody === null) {
            reject('workitem request body is null');
            return;
        }

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

        console.log('Submitting workitem to DA...');

        request(options, function (error, response, body) {
            if (error) {
                console.log('Workitem submission error:', error);
                reject(error);
                return;
            }

            let resp;
            try {
                resp = typeof body === 'string' ? JSON.parse(body) : body;
            } catch (e) {
                resp = body;
            }

            if (response.statusCode >= 400) {
                console.log('Workitem submission failed:', response.statusCode, response.statusMessage);
                
                // Handle specific DA API errors
                if (response.statusCode === 429) {
                    reject(new Error('Rate limit exceeded. Please wait before submitting more workitems.'));
                } else if (response.statusCode === 400 && resp.Error && resp.Error.includes('quota')) {
                    reject(new Error('Workitem quota exceeded. Please wait for current jobs to complete.'));
                } else {
                    reject({
                        statusCode: response.statusCode,
                        statusMessage: response.statusMessage,
                        details: resp
                    });
                }
                return;
            }

            // Determine operation type
            const isExplicitlyNewVersion = Boolean(isNewVersion);
            const hasVersionDataType = createVersionData?.data?.type === 'versions';
            const isVersionOperation = isExplicitlyNewVersion || hasVersionDataType;

            console.log(`Workitem submitted successfully: ${resp.id}`);
            console.log(`- Operation type: ${isVersionOperation ? 'VERSION' : 'ITEM'}`);

            // Enhanced workitem data storage
            const workitemData = {
                workitemId: resp.id,
                projectId: projectId,
                createVersionData: createVersionData,
                access_token_3Legged: {
                    access_token: access_token_3Legged.access_token,
                    refresh_token: access_token_3Legged.refresh_token,
                    expires_at: access_token_3Legged.expires_at
                },
                isNewVersion: isVersionOperation,
                operationType: createVersionData.data.type,
                fileItemId: createVersionData.data.relationships && 
                           createVersionData.data.relationships.item && 
                           createVersionData.data.relationships.item.data ? 
                           createVersionData.data.relationships.item.data.id : null,
                submittedAt: new Date(),
                inputUrl: inputUrl,
                outputUrl: outputUrl,
                fileExtension: fileExtension
            };

            // Add to both tracking systems
            workitemList.push(workitemData);
            workitemTracker.addWorkitem(resp.id, workitemData);

            resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: resp
            });
        });
    });
}

///////////////////////////////////////////////////////////////////////
/// Get latest version info
///////////////////////////////////////////////////////////////////////
async function getLatestVersionInfo(projectId, fileId, oauth_client, oauth_token) {
    if (projectId === '' || fileId === '') {
        console.log('failed to get latest version of the file');
        return null;
    }

    try {
        const versionItem = await getLatestVersion(projectId, fileId, oauth_client, oauth_token);
        if (versionItem === null) {
            console.log('failed to get latest version of the file');
            return null;
        }
        return {
            "versionStorageId": versionItem.relationships.storage.data.id,
            "versionType": versionItem.attributes.extension.type
        };
    } catch (error) {
        console.log('Error getting latest version info:', error);
        return null;
    }
}

///////////////////////////////////////////////////////////////////////
/// Get latest version
///////////////////////////////////////////////////////////////////////
async function getLatestVersion(projectId, itemId, oauthClient, credentials) {
    try {
        const items = new ItemsApi();
        const versions = await items.getItemVersions(projectId, itemId, {}, oauthClient, credentials);
        if (versions === null || versions.statusCode !== 200) {
            console.log('failed to get the versions of file');
            return null;
        }
        return versions.body.data[0];
    } catch (error) {
        console.log('Error getting latest version:', error);
        return null;
    }
}

///////////////////////////////////////////////////////////////////////
/// Create new storage
///////////////////////////////////////////////////////////////////////
async function getNewCreatedStorageInfo(projectId, folderId, fileName, oauth_client, oauth_token) {
    try {
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
    } catch (error) {
        console.log('Error creating storage:', error);
        return null;
    }
}

///////////////////////////////////////////////////////////////////////
/// Create item body
///////////////////////////////////////////////////////////////////////
function createBodyOfPostItem(fileName, folderId, storageId, itemType, versionType) {
    const body = {
        "jsonapi": {
            "version": "1.0"
        },
        "data": {
            "type": "items",
            "attributes": {
                "name": fileName,
                "extension": {
                    "type": itemType,
                    "version": "1.0"
                }
            },
            "relationships": {
                "tip": {
                    "data": {
                        "type": "versions",
                        "id": "1"
                    }
                },
                "parent": {
                    "data": {
                        "type": "folders",
                        "id": folderId
                    }
                }
            }
        },
        "included": [
            {
                "type": "versions",
                "id": "1",
                "attributes": {
                    "name": fileName,
                    "extension": {
                        "type": versionType,
                        "version": "1.0"
                    }
                },
                "relationships": {
                    "storage": {
                        "data": {
                            "type": "objects",
                            "id": storageId
                        }
                    }
                }
            }
        ]
    };
    return body;
}

///////////////////////////////////////////////////////////////////////
/// Create storage body
///////////////////////////////////////////////////////////////////////
function createBodyOfPostStorage(folderId, fileName) {
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
/// Enhanced version creation with proper metadata
///////////////////////////////////////////////////////////////////////
function createBodyOfPostVersion(fileId, fileName, storageId, versionType, targetVersion) {
    // Create the exact JSON structure required by the API
    const versionBody = {
        "jsonapi": {
            "version": "1.0"
        },
        "data": {
            "type": "versions", // Explicitly use "versions" type
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
    
    console.log('Version payload data type:', versionBody.data.type);
    return versionBody;
}

///////////////////////////////////////////////////////////////////////
/// Create workitem body with enhanced error handling
///////////////////////////////////////////////////////////////////////
function createPostWorkitemBody(inputUrl, outputUrl, fileExtension, access_token) {
    if (!designAutomation.nickname || !designAutomation.activity_name || !designAutomation.appbundle_activity_alias) {
        console.error('Missing Design Automation configuration');
        return null;
    }

    const activityId = `${designAutomation.nickname}.${designAutomation.activity_name}+${designAutomation.appbundle_activity_alias}`;
    
    let body = null;
    switch (fileExtension) {
        case 'rvt':
            body = {
                activityId: activityId,
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
                activityId: activityId,
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
        case 'fte':
        case 'rte':
            body = {
                activityId: activityId,
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
        default:
            console.error('Unsupported file extension:', fileExtension);
            return null;
    }
    
    console.log(`Created workitem body for ${fileExtension} file with activity: ${activityId}`);
    return body;
}

///////////////////////////////////////////////////////////////////////
/// Check if file was already upgraded to target version
///////////////////////////////////////////////////////////////////////
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

function findWorkitemById(workitemId) {
    const workitem = workitemList.find(item => item.workitemId === workitemId);
    if (workitem) {
        console.log(`✅ Found workitem ${workitemId} in list`);
        return workitem;
    } else {
        console.log(`❌ Workitem ${workitemId} NOT found. Available:`, workitemList.map(w => w.workitemId));
        return null;
    }
}

///////////////////////////////////////////////////////////////////////
/// Get active workitem count for rate limiting
///////////////////////////////////////////////////////////////////////
function getActiveWorkitemCount() {
    return workitemTracker.getActiveCount();
}

///////////////////////////////////////////////////////////////////////
/// Log payload for debugging
///////////////////////////////////////////////////////////////////////
function logPayload(title, payload) {
    console.log(`------ ${title} ------`);
    console.log(JSON.stringify(payload, null, 2));
    console.log('------------------------');
    return payload; 
}

module.exports = { 
    getWorkitemStatus, 
    cancelWorkitem, 
    upgradeFile, 
    getLatestVersionInfo, 
    getNewCreatedStorageInfo, 
    createBodyOfPostVersion,
    createBodyOfPostItem,
    isFileAlreadyUpgraded,
    logPayload,
    getActiveWorkitemCount,
    workitemList,
    workitemTracker,
    findWorkitemById
};
