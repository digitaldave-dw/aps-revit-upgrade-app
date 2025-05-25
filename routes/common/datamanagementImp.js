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
const { HubsApi, ProjectsApi, FoldersApi, ItemsApi } = require('forge-apis');


function isWorksharingFile(item) {
    // Add detailed logging to understand what we're checking
    console.log('Checking item for worksharing:', {
        name: item.attributes?.displayName || item.attributes?.name,
        type: item.type,
        extensionType: item.attributes?.extension?.type,
        fullItem: item
    });
    
    // Check multiple possible indicators of workshared files
    if (item.attributes && item.attributes.extension) {
        const extensionType = item.attributes.extension.type;
        
        // Check for C4R model type
        if (extensionType === 'versions:autodesk.bim360:C4RModel') {
            console.log('Found C4R workshared file:', item.attributes.displayName || item.attributes.name);
            return true;
        }
        
        // Also check for other possible worksharing indicators
        if (extensionType && extensionType.includes('C4R')) {
            console.log('Found file with C4R in extension type:', extensionType);
            return true;
        }
        
        // Check if the item has worksharing-related attributes
        if (item.attributes.extension.data && 
            item.attributes.extension.data.isCompositeDesign) {
            console.log('Found composite design (workshared) file:', item.attributes.displayName || item.attributes.name);
            return true;
        }
    }
    
    return false;
}

///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function createFolderBody(folderName, folderId) {

    // TBD: the parameter body type(CreateBody) is not defined yet, use raw json data as body for now
    return folderBody = {
        "jsonapi": {
            "version": "1.0"
        },
        "data": {
            "type": "folders",
            "attributes": {
                "name": folderName,
                "extension": {
                    "type": "folders:autodesk.bim360:Folder",
                    "version": "1.0"
                }
            },
            "relationships": {
                "parent": {
                    "data": {
                        "type": "folders",
                        "id": folderId
                    }
                }
            }
        }
    }
}


///////////////////////////////////////////////////////////////////////
///
///
///////////////////////////////////////////////////////////////////////
function deleteFolder(projectId, folderId, access_token) {

    return new Promise(function (resolve, reject) {

        var options = {
            method: 'PATCH',
            url: 'https://developer.api.autodesk.com/data/v1/projects/' + projectId + '/folders/' + folderId,
            headers: {
                'Content-Type': 'application/vnd.api+json',
                Authorization: 'Bearer ' + access_token
            },
            body: '{ "jsonapi": {"version": "1.0" },"data": {"type": "folders","id": "' + folderId + '","attributes": {"hidden":true}}}'
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

async function getHubs(oauthClient, credentials, res) {
    const hubs = new HubsApi();
    const data = await hubs.getHubs({}, oauthClient, credentials);
    const treeNodes = data.body.data.map((hub) => {
        if( hub.attributes.extension.type === 'hubs:autodesk.bim360:Account'){
            const hubType = 'bim360Hubs';
            return createTreeNode(
                hub.links.self.href,
                hub.attributes.name,
                hubType,
                true
            );
        }else
            return null;
        });
    // Only BIM360 hubs are supported for now
    res.json(treeNodes.filter(node => node !== null));
}

async function getProjects(hubId, oauthClient, credentials, res) {
    const projects = new ProjectsApi();
    const data = await projects.getHubProjects(hubId, {}, oauthClient, credentials);
    res.json(data.body.data.map((project) => {
        let projectType = 'projects';
        switch (project.attributes.extension.type) {
            case 'projects:autodesk.core:Project':
                projectType = 'a360projects';
                break;
            case 'projects:autodesk.bim360:Project':
                projectType = 'bim360projects';
                break;
        }
        return createTreeNode(
            project.links.self.href,
            project.attributes.name,
            projectType,
            true
        );
    }));
}

async function getFolders(hubId, projectId, oauthClient, credentials, res) {
    const projects = new ProjectsApi();
    const folders = await projects.getProjectTopFolders(hubId, projectId, oauthClient, credentials);
    res.json(folders.body.data.map((item) => {
        return createTreeNode(
            item.links.self.href,
            item.attributes.displayName === null ? item.attributes.name : item.attributes.displayName,
            item.type,
            true
        );
    }));
}

async function getFolderContents(projectId, folderId, oauthClient, credentials, res) {
    const folders = new FoldersApi();
    
    try {
        console.log(`Getting folder contents for project: ${projectId}, folder: ${folderId}`);
        const contents = await folders.getFolderContents(projectId, folderId, {}, oauthClient, credentials);
        
        console.log(`Found ${contents.body.data.length} items in folder`);
        
        // Count different types of files
        let revitFileCount = 0;
        let worksharedCount = 0;
        let otherCount = 0;
        
        const treeNodes = contents.body.data.map((item) => {
            var name = (item.attributes.displayName !== null ? item.attributes.displayName : item.attributes.name);
            
            if (name !== '') {
                // Check file extension
                const extension = name.split('.').pop().toLowerCase();
                if (extension === 'rvt') {
                    revitFileCount++;
                }
                
                // Check if this is a workshared file
                const isWorkshared = isWorksharingFile(item);
                if (isWorkshared) {
                    worksharedCount++;
                }
                
                // Add worksharing indicator to the name if applicable
                if (isWorkshared && item.type === 'items') {
                    name = '🔒 ' + name + ' (Workshared)';
                }
                
                // Create the tree node with additional metadata
                const node = createTreeNode(
                    item.links.self.href,
                    name,
                    isWorkshared ? 'workshared-item' : item.type,
                    item.type === 'folders'
                );
                
                // Add metadata to help with filtering
                node.isWorkshared = isWorkshared;
                if (item.attributes && item.attributes.extension) {
                    node.extensionType = item.attributes.extension.type;
                }
                
                // Add original data for debugging
                node.original = {
                    extensionType: item.attributes?.extension?.type,
                    extensionData: item.attributes?.extension?.data
                };
                
                return node;
            } else {
                otherCount++;
                return null;
            }
        });
        
        console.log(`Folder analysis: ${revitFileCount} Revit files, ${worksharedCount} workshared, ${otherCount} other`);
        
        res.json(treeNodes.filter(node => node !== null));
    } catch (error) {
        console.error('Error getting folder contents:', error);
        res.status(500).json({ error: 'Failed to get folder contents' });
    }
}


async function getFolderContentsForUpgrade(projectId, folderId, oauthClient, credentials) {
    const folders = new FoldersApi();
    const contents = await folders.getFolderContents(projectId, folderId, {}, oauthClient, credentials);
    
    // Filter out workshared files and return only upgradeable items
    const upgradeableItems = contents.body.data.filter((item) => {
        // Skip if not an item (could be a folder)
        if (item.type !== 'items') return false;
        
        // Skip if no name
        const name = item.attributes.displayName || item.attributes.name;
        if (!name || name === '') return false;
        
        // Skip if workshared
        if (isWorksharingFile(item)) {
            console.log(`Skipping workshared file: ${name}`);
            return false;
        }
        
        // Check file extension
        const extension = name.split('.').pop().toLowerCase();
        const supportedExtensions = ['rvt', 'rfa', 'rte'];
        
        return supportedExtensions.includes(extension);
    });
    
    return {
        allItems: contents.body.data,
        upgradeableItems: upgradeableItems,
        worksharedCount: contents.body.data.filter(isWorksharingFile).length
    };
}

async function getVersions(projectId, itemId, oauthClient, credentials, res) {
    const items = new ItemsApi();
    const versions = await items.getItemVersions(projectId, itemId, {}, oauthClient, credentials);

    const versions_json = versions.body.data.map( (version) => {
        const dateFormated = new Date(version.attributes.lastModifiedTime).toLocaleString();
        const versionst = version.id.match(/^(.*)\?version=(\d+)$/)[2];
        const viewerUrn = (version.relationships != null && version.relationships.derivatives != null && version.relationships.derivatives.data != null ? version.relationships.derivatives.data.id : null);
        return createTreeNode(
            viewerUrn,
            decodeURI('v' + versionst + ': ' + dateFormated + ' by ' + version.attributes.lastModifiedUserName),
            (viewerUrn != null ? 'versions' : 'unsupported'),
            false
        );
    })
    res.json(versions_json.filter(node=>node!=null));
}

// Format data for tree
function createTreeNode(_id, _text, _type, _children) {
    return { id: _id, text: _text, type: _type, children: _children };
}

module.exports = {
    createFolderBody,
    deleteFolder,
    getHubs,
    getProjects,
    getFolders,
    getFolderContents,
    getVersions,
    isWorksharingFile,
    getFolderContentsForUpgrade
}