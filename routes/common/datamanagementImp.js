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
const { 
    HubsApi, 
    ProjectsApi, 
    FoldersApi, 
    ItemsApi,
    VersionsApi  
} = require('forge-apis');


async function getHubIdForProject(projectId, oauth_client, oauth_token) {
    console.log(`Finding hub for project ${projectId}...`);
    
    const hubs = new HubsApi();
    const projects = new ProjectsApi();
    
    try {
        // Get all hubs accessible to the user
        const hubsResponse = await hubs.getHubs({}, oauth_client, oauth_token);
        
        // Search each hub for the project
        for (const hub of hubsResponse.body.data) {
            try {
                const projectsResponse = await projects.getHubProjects(hub.id, {}, oauth_client, oauth_token);
                
                // Check if our project is in this hub
                const foundProject = projectsResponse.body.data.find(p => p.id === projectId);
                
                if (foundProject) {
                    console.log(`Found project ${projectId} in hub ${hub.id} (${hub.attributes.name})`);
                    return hub.id;
                }
            } catch (err) {
                // This hub might not be accessible, continue searching
                console.log(`Could not search hub ${hub.id}: ${err.message}`);
            }
        }
        
        throw new Error(`Project ${projectId} not found in any accessible hub`);
        
    } catch (error) {
        console.error('Error finding hub for project:', error);
        throw error;
    }
}

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

/**
 * Recursively retrieves all folders and files in a project
 * This function builds a complete tree structure of the project
 * @param {string} projectId - The project to scan
 * @param {string} folderId - Current folder being scanned (null for root)
 * @param {object} oauth_client - OAuth client
 * @param {object} oauth_token - OAuth token
 * @param {string} parentPath - Path of parent folders for tracking
 * @returns {object} Tree structure with folders and files
 */
async function getProjectStructure(projectId, folderId, oauth_client, oauth_token, parentPath = '') {
    try {
        console.log(`Getting project structure for project: ${projectId}, folder: ${folderId || 'root'}`);
        
        // Ensure oauth_token has the proper structure
        let authToken = oauth_token;
        if (typeof oauth_token === 'object' && oauth_token.access_token) {
            authToken = oauth_token;
        } else if (typeof oauth_token === 'string') {
            authToken = { access_token: oauth_token };
        } else {
            throw new Error('Invalid OAuth token format');
        }
        
        const folders = new FoldersApi();
        const projects = new ProjectsApi();
        
        // If no folderId provided, get the root folders
        if (!folderId) {
            console.log(`Getting root folders for project ${projectId}`);
            
            // CRITICAL: Get the hub ID for this project
            const hubId = await getHubIdForProject(projectId, oauth_client, authToken);
            
            console.log(`Using hub ID: ${hubId} for project ID: ${projectId}`);
            
            // Now get the top folders with the correct hub ID
            const topFolders = await projects.getProjectTopFolders(
                hubId,      // Use the found hub ID
                projectId,  // Use the project ID
                oauth_client, 
                authToken
            );
            
            if (topFolders.body.data && topFolders.body.data.length > 0) {
                console.log(`Found ${topFolders.body.data.length} root folders`);
                
                // Process each root folder recursively
                const rootFolders = [];
                for (const folder of topFolders.body.data) {
                    try {
                        const folderStructure = await getProjectStructure(
                            projectId,
                            folder.id, 
                            oauth_client, 
                            authToken,
                            folder.attributes.name
                        );
                        rootFolders.push(folderStructure);
                    } catch (err) {
                        console.error(`Error processing root folder ${folder.id}:`, err.message);
                        rootFolders.push({
                            id: folder.id,
                            name: folder.attributes.name,
                            type: 'folder',
                            items: [],
                            folders: [],
                            error: err.message
                        });
                    }
                }
                
                return {
                    type: 'root',
                    folders: rootFolders,
                    hubId: hubId
                };
            } else {
                console.log('No root folders found in project');
                return {
                    type: 'root',
                    folders: [],
                    hubId: hubId
                };
            }
        }
        
        // If we have a folder ID, get its contents
        console.log(`Getting contents for folder ${folderId}`);
        
        const folderData = await folders.getFolder(projectId, folderId, oauth_client, authToken);
        const folderName = folderData.body.data.attributes.displayName || folderData.body.data.attributes.name;
        const currentPath = parentPath ? `${parentPath}/${folderName}` : folderName;
        
        console.log(`Processing folder: ${currentPath}`);
        
        // Get folder contents
        let contents;
        try {
            contents = await folders.getFolderContents(
                projectId, 
                folderId, 
                {}, 
                oauth_client, 
                authToken
            );
        } catch (contentsError) {
            console.error(`Error getting contents of folder ${folderId}:`, contentsError.message);
            return {
                id: folderId,
                name: folderName,
                path: currentPath,
                type: 'folder',
                items: [],
                folders: [],
                attributes: folderData.body.data.attributes,
                error: 'Unable to fetch folder contents'
            };
        }
        
        // Process items and subfolders
        const items = [];
        const subfolders = [];
        
        if (contents.body && contents.body.data) {
            for (const item of contents.body.data) {
                if (item.type === 'items') {
                    const fileName = item.attributes.displayName || item.attributes.name;
                    const extension = fileName.split('.').pop().toLowerCase();
                    
                    if (['rvt', 'rfa', 'rte'].includes(extension)) {
                        items.push({
                            id: item.id,
                            name: fileName,
                            type: item.type,
                            extension: extension,
                            path: currentPath,
                            attributes: item.attributes,
                            links: item.links,
                            isWorkshared: isWorksharingFile(item)
                        });
                        console.log(`  Found: ${fileName}${isWorksharingFile(item) ? ' (WORKSHARED)' : ''}`);
                    }
                } else if (item.type === 'folders') {
                    subfolders.push(item);
                }
            }
        }
        
        console.log(`  Total: ${items.length} files, ${subfolders.length} subfolders`);
        
        // Process subfolders recursively
        const subfolderStructures = [];
        for (const subfolder of subfolders) {
            try {
                const subStructure = await getProjectStructure(
                    projectId, 
                    subfolder.id, 
                    oauth_client, 
                    authToken, 
                    currentPath
                );
                subfolderStructures.push(subStructure);
            } catch (subError) {
                console.error(`Error processing subfolder ${subfolder.id}:`, subError.message);
                subfolderStructures.push({
                    id: subfolder.id,
                    name: subfolder.attributes.displayName || subfolder.attributes.name,
                    path: `${currentPath}/${subfolder.attributes.name}`,
                    type: 'folder',
                    items: [],
                    folders: [],
                    error: 'Unable to access subfolder'
                });
            }
        }
        
        return {
            id: folderId,
            name: folderName,
            path: currentPath,
            type: 'folder',
            items: items,
            folders: subfolderStructures,
            attributes: folderData.body.data.attributes
        };
        
    } catch (error) {
        console.error(`Error in getProjectStructure: ${error.message}`);
        if (error.response && error.response.data) {
            console.error('API error details:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * Helper function to extract hub ID from project ID
 * BIM360 project IDs have format: b.{guid}
 * We need to ensure we're working with the right format
 */
function extractHubId(projectId) {
    // If projectId is an object, extract the string ID
    const projectIdStr = typeof projectId === 'object' ? (projectId.id || projectId.toString()) : projectId;
    
    // BIM360 project IDs typically start with 'b.'
    if (projectIdStr.startsWith('b.')) {
        // The hub ID is the same as the project ID for BIM360
        return projectIdStr;
    }
    
    // For other project types, we might need different logic
    console.warn(`Project ID ${projectIdStr} doesn't follow expected format`);
    return projectIdStr;
}

/**
 * Creates a folder hierarchy in the destination project
 * Ensures all parent folders exist before creating child folders
 * @param {string} projectId - Destination project ID
 * @param {object} folderStructure - Folder structure to create
 * @param {string} parentFolderId - Parent folder ID in destination
 * @param {object} oauth_client - OAuth client
 * @param {object} oauth_token - OAuth token
 * @returns {object} Mapping of source to destination folder IDs
 */
async function createFolderStructure(projectId, folderStructure, parentFolderId, oauth_client, oauth_token) {
    const folderMapping = {};
    const folders = new FoldersApi();
    
    try {
        // Skip if this is the root node
        if (folderStructure.type === 'root') {
            // Process root folders
            for (const rootFolder of folderStructure.folders) {
                const rootMapping = await createFolderStructure(
                    projectId, 
                    rootFolder, 
                    null, // Root folders don't have parents in the API sense
                    oauth_client, 
                    oauth_token
                );
                Object.assign(folderMapping, rootMapping);
            }
            return folderMapping;
        }
        
        // Check if folder already exists in destination
        let destinationFolderId = null;
        
        if (parentFolderId) {
            // Get contents of parent folder to check for existing folder
            const parentContents = await folders.getFolderContents(
                projectId, 
                parentFolderId, 
                {}, 
                oauth_client, 
                oauth_token
            );
            
            // Look for folder with same name
            const existingFolder = parentContents.body.data.find(
                item => item.type === 'folders' && 
                        item.attributes.name === folderStructure.name
            );
            
            if (existingFolder) {
                destinationFolderId = existingFolder.id;
                console.log(`Folder already exists: ${folderStructure.path}`);
            }
        }
        
        // Create folder if it doesn't exist
        if (!destinationFolderId && parentFolderId) {
            const createFolderBody = {
                jsonapi: { version: "1.0" },
                data: {
                    type: "folders",
                    attributes: {
                        name: folderStructure.name,
                        extension: {
                            type: "folders:autodesk.bim360:Folder",
                            version: "1.0"
                        }
                    },
                    relationships: {
                        parent: {
                            data: {
                                type: "folders",
                                id: parentFolderId
                            }
                        }
                    }
                }
            };
            
            try {
                const newFolder = await postFolder(projectId, createFolderBody, oauth_client, oauth_token);
                destinationFolderId = newFolder.body.data.id;
                console.log(`Created folder: ${folderStructure.path}`);
            } catch (error) {
                if (error.statusCode === 409) {
                    // Folder was created by another process, try to find it again
                    console.log(`Folder creation conflict, retrying: ${folderStructure.path}`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return await createFolderStructure(projectId, folderStructure, parentFolderId, oauth_client, oauth_token);
                }
                throw error;
            }
        }
        
        // For root folders, use the folder ID from the structure
        if (!parentFolderId) {
            destinationFolderId = await findOrCreateRootFolder(
                projectId, 
                folderStructure.name, 
                oauth_client, 
                oauth_token
            );
        }
        
        // Add mapping
        folderMapping[folderStructure.id] = destinationFolderId;
        
        // Recursively create subfolders
        for (const subfolder of folderStructure.folders || []) {
            const subMapping = await createFolderStructure(
                projectId, 
                subfolder, 
                destinationFolderId, 
                oauth_client, 
                oauth_token
            );
            Object.assign(folderMapping, subMapping);
        }
        
        return folderMapping;
        
    } catch (error) {
        console.error(`Error creating folder structure: ${error.message}`);
        throw error;
    }
}

/**
 * Helper function to find or create root folders (Plans, Project Files, etc.)
 */
async function findOrCreateRootFolder(projectId, folderName, oauth_client, oauth_token) {
    const projects = new ProjectsApi();
    const topFolders = await projects.getProjectTopFolders(projectId, oauth_client, oauth_token);
    
    // Check if the root folder already exists
    const existingFolder = topFolders.body.data.find(
        folder => folder.attributes.name === folderName
    );
    
    if (existingFolder) {
        return existingFolder.id;
    }
    
    // If not found, we can't create root folders via API
    // Return the first available root folder as fallback
    if (topFolders.body.data.length > 0) {
        console.log(`Warning: Cannot create root folder '${folderName}', using default root folder`);
        return topFolders.body.data[0].id;
    }
    
    throw new Error('No root folders found in destination project');
}

/**
 * Helper function to create a folder (handles the API call)
 */
async function postFolder(projectId, folderBody, oauth_client, oauth_token) {
    const projects = new ProjectsApi();
    return await projects.postFolderRelationshipsRef(
        projectId,
        folderBody.data.relationships.parent.data.id,
        folderBody,
        oauth_client,
        oauth_token
    );
}

/**
 * Recursively searches for all folders and files in a project using the search API
 * This is more efficient for large projects than traversing folder by folder
 */
async function searchProjectFiles(projectId, folderId, oauth_client, oauth_token, supportedTypes = ['rvt', 'rfa', 'rte']) {
    const allFiles = [];
    let pageNumber = 0;
    const maxPages = 50; // API limit
    
    try {
        while (pageNumber < maxPages) {
            const searchUrl = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/folders/${folderId}/search?` +
                `filter[extension.type]=items:autodesk.bim360:File&` +
                `page[number]=${pageNumber}`;
            
            const searchResponse = await new Promise((resolve, reject) => {
                const request = require("request");
                request({
                    url: searchUrl,
                    method: 'GET',
                    headers: {
                        'Authorization': 'Bearer ' + oauth_token.access_token,
                        'Content-Type': 'application/json'
                    }
                }, (error, response, body) => {
                    if (error) reject(error);
                    else resolve({ response, body: JSON.parse(body) });
                });
            });
            
            if (!searchResponse.body.data || searchResponse.body.data.length === 0) {
                break; // No more results
            }
            
            // Filter for supported file types
            const revitFiles = searchResponse.body.data.filter(item => {
                if (item.type !== 'versions') return false;
                const fileName = item.attributes.displayName || item.attributes.name;
                const extension = fileName.split('.').pop().toLowerCase();
                return supportedTypes.includes(extension);
            });
            
            // Get folder information for each file from included data
            const filesWithFolders = revitFiles.map(file => {
                // Find the corresponding item in included data
                const itemData = searchResponse.body.included?.find(
                    inc => inc.type === 'items' && 
                           inc.relationships?.tip?.data?.id === file.id
                );
                
                return {
                    versionId: file.id,
                    itemId: itemData?.id,
                    fileName: file.attributes.displayName || file.attributes.name,
                    parentFolderId: itemData?.relationships?.parent?.data?.id,
                    attributes: file.attributes,
                    itemAttributes: itemData?.attributes
                };
            });
            
            allFiles.push(...filesWithFolders);
            pageNumber++;
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        console.log(`Found ${allFiles.length} Revit files in project search`);
        return allFiles;
        
    } catch (error) {
        console.error('Error searching project files:', error);
        throw error;
    }
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
    getFolderContentsForUpgrade,
    getProjectStructure,
    createFolderStructure,
    searchProjectFiles
}