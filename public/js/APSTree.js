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

/////////////////////////////////////////////////////////////////////
// Enhanced APSTree.js with Bulk Processing Support
// Copyright (c) Autodesk, Inc. All rights reserved
/////////////////////////////////////////////////////////////////////

$(document).ready(function () {
  // first, check if current visitor is signed in
  jQuery.ajax({
    url: '/api/aps/oauth/v1/token',
    success: function (res) {
      // yes, it is signed in...
      $('#autodeskSignOutButton').show();
      $('#autodeskSigninButton').hide();

      $('#refreshSourceHubs').show();
      
      // add right panel
      $('#refreshDestinationHubs').show();

      // prepare sign out
      $('#autodeskSignOutButton').click(function () {
        $('#hiddenFrame').on('load', function (event) {
          location.href = '/api/aps/oauth/v1/signout';
        });
        $('#hiddenFrame').attr('src', 'https://accounts.autodesk.com/Authentication/LogOut');
      })

      // and refresh button
      $('#refreshSourceHubs').click(function () {
        $('#sourceHubs').jstree(true).refresh();
      });

      $('#refreshDestinationHubs').click(function () {
        $('#destinationHubs').jstree(true).refresh();
      });

      prepareUserHubsTree( '#sourceHubs' );
      prepareUserHubsTree( '#destinationHubs');
      showUser();
    },
    error: function(err){
      $('#autodeskSignOutButton').hide();
      $('#autodeskSigninButton').show();
    }
  });

  $('#autodeskSigninButton').click(function () {
    jQuery.ajax({
      url: '/api/aps/oauth/v1/url',
      success: function (url) {
        location.href = url;
      }
    });
  })

  $.getJSON("/api/aps/oauth/v1/clientid", function (res) {
    $("#ClientID").val(res.id);
    $("#provisionAccountSave").click(function () {
      $('#provisionAccountModal').modal('toggle');
      $('#sourceHubs').jstree(true).refresh();
      $('#destinationHubs').jstree(true).refresh();
    });
  });  

  // Enhanced upgrade button with bulk processing support
  $('#upgradeBtn').click(async function () {
    let sourceNode = $('#sourceHubs').jstree(true).get_selected(true)[0];
    if(sourceNode === null){
      alert('Can not get the selected source folder, please make sure you select a folder as source');
      return;
    }
    destinatedNode  = $('#destinationHubs').jstree(true).get_selected(true)[0];
    if(destinatedNode === null){
      alert('Can not get the destinate folder, please make sure you select a folder as destination');
      return;
    }

    if(sourceNode.type !== 'folders' || destinatedNode.type !== 'folders'){
      alert('Currently only support upgrading files from folder to folder, please make sure select folder as source and destination.');
      return;
    }

    // Get upgrade settings
    bUpgrade2023 =  $('input[name="upgradeToVersion"]:checked').val() === '2023';
    const targetVersion = $('input[name="upgradeToVersion"]:checked').val();
    bIgnore      =  $('input[name="fileExisted"]:checked').val() === 'skip';

    bSupportRvt = $('#supportRvtCbx')[0].checked;
    bSupportRfa = $('#supportRfaCbx')[0].checked;
    bSupportRte = $('#supportRteCbx')[0].checked;

    // Get bulk processing preference
    const useBulkProcessing = $('#bulkProcessingCbx')[0].checked;

    // Clear previous logs
    let logList = document.getElementById('logStatus');
    let index = logList.childElementCount;
    while(index > 0){
      logList.removeChild(logList.firstElementChild);
      index--;
    }

    // Disable the upgrade button    
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = true;

    if (useBulkProcessing) {
      // Use new bulk processing approach
      document.getElementById('upgradeTitle').innerHTML = "<h4>🚀 Starting Bulk Processing (No File Limit)...</h4>";
      await startBulkProcessing(sourceNode, destinatedNode, targetVersion);
    } else {
      // Use original approach with 5-file limitation
      document.getElementById('upgradeTitle').innerHTML = "<h4>Start upgrading Revit files (Limited to 5 files)...</h4>";
      fileNumber = 0;
      await upgradeFolder(sourceNode, destinatedNode);
      document.getElementById('upgradeTitle').innerHTML = "<h4>Creating versions in BIM360...</h4>";
    }
  });

  // Add bulk processing toggle handler
  $('#bulkProcessingCbx').change(function() {
    const isChecked = this.checked;
    const limitationText = document.getElementById('limitationText');
    if (limitationText) {
      if (isChecked) {
        limitationText.innerHTML = '<span style="color: green;">✓ Bulk Processing Enabled - No File Limit</span>';
      } else {
        limitationText.innerHTML = '<span style="color: orange;">⚠️ Legacy Mode - 5 File Limit</span>';
      }
    }
  });
});

var bSupportRvt = true;
var bSupportRfa = true;
var bSupportRte = true;
var bIgnore     = true;
var bUpgrade2023= true;

// Remove hardcoded file limitation for bulk processing
const FileLimitation = 5; // Keep for legacy mode
var fileNumber = 0;

// Enhanced bulk processing variables
var currentBatchId = null;
var bulkProcessingActive = false;
var bulkProgressInterval = null;

var totalFilesProcessed = 0;  // NEW: Track total files processed
var fileQueue = [];            // NEW: Queue for pending files
var isProcessingQueue = false; // NEW: Flag to prevent concurrent queue processing

const ItemType = {
  FILE : 1,
  FOLDER: 2
};

const LabelIdEndfix  = '-item';
const CancelIdEndfix = '-cancel';

var workitemList    = new Array();
var destinatedNode  = null;
var sourceNode      = null;

const SOCKET_TOPIC_WORKITEM = 'Workitem-Notification';
const SOCKET_TOPIC_BULK_PROGRESS = 'Bulk-Progress-Notification';

socketio = io();

// Enhanced socket handling for both individual and bulk processing
socketio = io();
socketio.on(SOCKET_TOPIC_WORKITEM, async (data)=>{
  console.log(data);
  updateListItem(data.WorkitemId, data.Status);
  
  if(data.Status.toLowerCase() === 'completed' || 
     data.Status.toLowerCase() === 'failed' || 
     data.Status.toLowerCase() === 'cancelled'){
    
    // Properly remove the specific workitem
    const index = workitemList.findIndex(item => item === data.WorkitemId);
    if(index !== -1) {
      workitemList.splice(index, 1);
    }
    
    totalFilesProcessed++;
    
    // Process next file in queue if available
    if(workitemList.length < FileLimitation && fileQueue.length > 0) {
      processNextInQueue();
    }
  }
  
  // Check if all processing is complete
  if(workitemList.length === 0 && fileQueue.length === 0){
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    document.getElementById('upgradeTitle').innerHTML = 
      `<h4>Upgrade Fully Completed! (${totalFilesProcessed} files processed)</h4>`;

    // Reset counters for next run
    fileNumber = 0;
    totalFilesProcessed = 0;
    
    // Refresh the tree nodes
    if(sourceNode !== null){
      let instance = $('#sourceHubs').jstree(true);
      instance.refresh_node(sourceNode);
      sourceNode = null;
    }
    if(destinatedNode !== null ){
      let instance = $('#destinationHubs').jstree(true);
      instance.refresh_node(destinatedNode);
      destinatedNode = null;
    }
  }
});

// New socket handler for bulk processing progress
socketio.on(SOCKET_TOPIC_BULK_PROGRESS, (data) => {
  console.log('Bulk progress update:', data);
  updateBulkProgress(data);
});

// New function to process next file in queue
async function processNextInQueue() {
  if(isProcessingQueue || fileQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  try {
    const nextFile = fileQueue.shift();
    if(nextFile) {
      const { node, destinationNode } = nextFile;
      
      try {
        let upgradeInfo = await upgradeFileToFolder(node.id, destinationNode.id);
        workitemList.push(upgradeInfo.workItemId);
        addGroupListItem(node.text, upgradeInfo.workItemStatus, ItemType.FILE, 
                        'list-group-item-info', upgradeInfo.workItemId);
      } catch (err) {
        addGroupListItem(node.text, 'failed', ItemType.FILE, 'list-group-item-danger');
        totalFilesProcessed++;
        
        // Try next file even if this one failed
        if(fileQueue.length > 0) {
          setTimeout(() => processNextInQueue(), 100);
        }
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// New bulk processing function
async function startBulkProcessing(sourceNode, destinationNode, targetVersion) {
  try {
    bulkProcessingActive = true;
    
    // Extract IDs from the source node instead of destination
    const sourceParams = sourceNode.id.split('/');
    const sourceFolderId = sourceParams[sourceParams.length - 1];
    const projectId = sourceParams[sourceParams.length - 3];

    // Create file filter based on supported file types
    const supportedTypes = [];
    if (bSupportRvt) supportedTypes.push('rvt');
    if (bSupportRfa) supportedTypes.push('rfa');
    if (bSupportRte) supportedTypes.push('rte');

    console.log('Starting bulk processing:', {
      projectId: projectId,
      folderId: sourceFolderId,  // Use source folder ID
      targetVersion: targetVersion,
      supportedTypes: supportedTypes
    });

    // Clear the log and show initial status
    const logList = document.getElementById('logStatus');
    logList.innerHTML = '';
    
    addGroupListItem(
      'Bulk Processing', 
      'Initializing...', 
      ItemType.FOLDER, 
      'list-group-item-info'
    );

    // Start bulk processing with the source folder
    const response = await jQuery.ajax({
      url: '/api/aps/da4revit/v1/upgrader/bulk',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        projectId: projectId,
        folderId: sourceFolderId,  // Send source folder ID
        targetVersion: targetVersion,
        supportedTypes: supportedTypes
      })
    });

    if (response.success) {
      currentBatchId = response.batchId;
      
      // Update the initial status
      const entries = Array.from(logList.children);
      if (entries.length > 0) {
        entries[0].className = 'list-group-item list-group-item-success';
        const label = entries[0].querySelector('label');
        if (label) {
          label.textContent = `, Processing ${response.totalFiles} files`;
        }
      }
      
      // Show file list
      if (response.files && response.files.length > 0) {
        response.files.forEach((fileName, index) => {
          if (index < 10) { // Show first 10 files
            addGroupListItem(fileName, 'QUEUED', ItemType.FILE, 'list-group-item-warning');
          }
        });
        
        if (response.files.length > 10) {
          addGroupListItem(
            `... and ${response.files.length - 10} more files`, 
            'QUEUED', 
            ItemType.FOLDER, 
            'list-group-item-warning'
          );
        }
      }
      
      document.getElementById('upgradeTitle').innerHTML = 
        `<h4>🚀 Bulk Processing Started - ${response.totalFiles} files queued</h4>`;
      
      // No need for manual progress monitoring - the WebSocket will handle it
      
    } else {
      throw new Error(response.error || 'Failed to start bulk processing');
    }

  } catch (error) {
    console.error('Bulk processing error:', error);
    
    let errorMessage = 'Unknown error';
    if (error.responseJSON && error.responseJSON.error) {
      errorMessage = error.responseJSON.error;
      if (error.responseJSON.supportedExtensions) {
        errorMessage += ` (Supported: ${error.responseJSON.supportedExtensions.join(', ')})`;
      }
    } else if (error.message) {
      errorMessage = error.message;
    } else if (error.statusText) {
      errorMessage = error.statusText;
    }
    
    addGroupListItem('Bulk Processing', 'Failed: ' + errorMessage, ItemType.FOLDER, 'list-group-item-danger');
    
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    bulkProcessingActive = false;
    document.getElementById('upgradeTitle').innerHTML = `<h4>❌ Bulk Processing Failed: ${errorMessage}</h4>`;
  }
}

// Monitor bulk processing progress
function startBulkProgressMonitoring() {
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
  }
  
  bulkProgressInterval = setInterval(async () => {
    if (!currentBatchId) return;
    
    try {
      const status = await jQuery.ajax({
        url: `/api/aps/da4revit/v1/upgrader/bulk/${currentBatchId}/status`,
        method: 'GET',
        dataType: 'json'
      });
      
      updateBulkProgress(status);
      
      // Check if processing is complete
      if (status.status === 'completed' || 
          (status.completedFiles + status.failedFiles >= status.totalFiles)) {
        stopBulkProgressMonitoring();
        finishBulkProcessing(status);
      }
      
    } catch (error) {
      console.error('Error getting bulk status:', error);
    }
  }, 3000); // Poll every 3 seconds
}

// Stop bulk progress monitoring
function stopBulkProgressMonitoring() {
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
    bulkProgressInterval = null;
  }
}

// Update bulk processing progress in UI
function updateBulkProgress(data) {
  const titleElement = document.getElementById('upgradeTitle');
  const progressPercent = data.totalFiles > 0 ? Math.round((data.completedFiles / data.totalFiles) * 100) : 0;
  
  titleElement.innerHTML = `
    <h4>📊 Bulk Processing Progress: ${data.completedFiles}/${data.totalFiles} (${progressPercent}%)</h4>
    <div class="progress" style="margin: 10px 0;">
      <div class="progress-bar progress-bar-success" role="progressbar" style="width: ${progressPercent}%">
        ${progressPercent}%
      </div>
    </div>
    <small>
      ✅ Completed: ${data.completedFiles} | 
      🔄 Processing: ${data.processingFiles || 0} | 
      ⏳ Queued: ${data.queuedFiles || 0} | 
      ❌ Failed: ${data.failedFiles || 0}
    </small>
  `;

  // Update individual file statuses if available
  if (data.files && data.files.length > 0) {
    updateBulkFileList(data.files);
  }
}

// Update bulk file list in UI
function updateBulkFileList(files) {
  const logList = document.getElementById('logStatus');
  
  // Clear existing file entries but keep the bulk processing header
  const entries = Array.from(logList.children);
  entries.forEach(entry => {
    if (entry.textContent.includes('File:') && 
        !entry.textContent.includes('Bulk Processing Started')) {
      entry.remove();
    }
  });

  // Group files by status for better organization
  const filesByStatus = {
    completed: files.filter(f => f.status === 'completed'),
    processing: files.filter(f => f.status === 'processing' || f.status === 'submitted'),
    queued: files.filter(f => f.status === 'queued'),
    failed: files.filter(f => f.status === 'failed')
  };

  // Show processing files first (limited to 5 for UI clarity)
  filesByStatus.processing.slice(0, 5).forEach(file => {
    const statusText = file.status === 'submitted' ? 'SUBMITTED TO DA' : 'PROCESSING';
    addBulkFileStatus(file.name, statusText, 'list-group-item-info', file.workItemId);
  });

  // Show recently completed files (limited to 5)
  filesByStatus.completed.slice(0, 5).forEach(file => {
    addBulkFileStatus(file.name, 'COMPLETED', 'list-group-item-success', file.workItemId);
  });

  // Show failed files (all of them, as these are important)
  filesByStatus.failed.forEach(file => {
    const errorText = file.error ? `FAILED: ${file.error}` : 'FAILED';
    addBulkFileStatus(file.name, errorText, 'list-group-item-danger', file.workItemId);
  });

  // Show queued files count if any
  if (filesByStatus.queued.length > 0) {
    addGroupListItem(
      `${filesByStatus.queued.length} files waiting in queue`, 
      'QUEUED', 
      ItemType.FOLDER, 
      'list-group-item-warning'
    );
  }

  // Add summary if there are many files
  const totalShown = Math.min(5, filesByStatus.processing.length) + 
                    Math.min(5, filesByStatus.completed.length) + 
                    filesByStatus.failed.length;
  const totalFiles = files.length;
  
  if (totalShown < totalFiles) {
    addGroupListItem(
      `... and ${totalFiles - totalShown} more files`, 
      'Various statuses', 
      ItemType.FOLDER, 
      'list-group-item-info'
    );
  }
}

function addBulkFileStatus(fileName, status, cssClass, workItemId) {
  const logList = document.getElementById('logStatus');
  
  // Check if this file already has an entry
  const existingEntry = Array.from(logList.children).find(entry => 
    entry.textContent.includes(`File:${fileName}`)
  );
  
  if (existingEntry) {
    // Update existing entry
    existingEntry.className = 'list-group-item ' + cssClass;
    const label = existingEntry.querySelector('label');
    if (label) {
      label.textContent = `, status: ${status}`;
    }
  } else {
    // Create new entry
    addGroupListItem(fileName, status, ItemType.FILE, cssClass, workItemId);
  }
}


// Get CSS class for file status
function getStatusClass(status) {
  switch (status.toLowerCase()) {
    case 'completed': return 'list-group-item-success';
    case 'failed': return 'list-group-item-danger';
    case 'processing': return 'list-group-item-info';
    case 'queued': return 'list-group-item-warning';
    default: return 'list-group-item-default';
  }
}

// Finish bulk processing
function finishBulkProcessing(finalStatus) {
  bulkProcessingActive = false;
  currentBatchId = null;
  
  // Stop any progress monitoring
  stopBulkProgressMonitoring();
  
  let upgradeBtnElm = document.getElementById('upgradeBtn');
  upgradeBtnElm.disabled = false;
  
  const successCount = finalStatus.completedFiles || 0;
  const failedCount = finalStatus.failedFiles || 0;
  const totalCount = finalStatus.totalFiles || 0;
  
  // Show final status
  let statusMessage;
  let statusIcon;
  
  if (failedCount === 0 && successCount === totalCount) {
    statusMessage = `Bulk Processing Completed Successfully!`;
    statusIcon = '🎉';
  } else if (successCount === 0) {
    statusMessage = `Bulk Processing Failed - All files failed`;
    statusIcon = '❌';
  } else {
    statusMessage = `Bulk Processing Completed with Issues`;
    statusIcon = '⚠️';
  }
  
  document.getElementById('upgradeTitle').innerHTML = `
    <h4>${statusIcon} ${statusMessage}</h4>
    <div style="margin-top: 10px;">
      <strong>Final Results:</strong><br>
      ✅ Successfully processed: ${successCount} files<br>
      ❌ Failed: ${failedCount} files<br>
      📁 Total: ${totalCount} files
    </div>
  `;

  // Clear queue status
  document.getElementById('queueStatus').innerHTML = '';

  // Refresh tree nodes after a short delay
  setTimeout(() => {
    if(sourceNode !== null){
      let instance = $('#sourceHubs').jstree(true);
      instance.refresh_node(sourceNode);
      sourceNode = null;
    }
    if(destinatedNode !== null ){
      let instance = $('#destinationHubs').jstree(true);
      instance.refresh_node(destinatedNode);
      destinatedNode = null;
    }
  }, 1000);
}

// Original folder upgrade function (kept for legacy mode)
async function upgradeFolder(sourceNode, destinationNode) {
  if (sourceNode === null || sourceNode.type !== 'folders')
    return false;

  if (destinationNode === null || destinationNode.type !== 'folders')
    return false;

  // Reset file queue for this folder
  fileQueue = [];
  
  let instance = $("#sourceHubs").jstree(true);
  instance.open_node(sourceNode, async function(e, data){
    let childrenDom = e.children;
    
    // First, collect all files that need processing
    let filesToProcess = [];
    
    for (let i = 0; i < childrenDom.length; i++) {
      let nodeDom = childrenDom[i];
      let node = instance.get_json(nodeDom);
  
      if (node.type === 'folders') {
        let destinatedSubFolder = null;
        try {
          destinatedSubFolder = await createNamedFolder(destinationNode, node.text);
          addGroupListItem(node.text, 'created', ItemType.FOLDER, 'active');
        } catch (err) {
          addGroupListItem(node.text, 'failed', ItemType.FOLDER, 'list-group-item-danger');
        }
        try{
          await upgradeFolder(node, destinatedSubFolder);
        }catch(err){
          addGroupListItem(node.text,'failed', ItemType.FOLDER, 'list-group-item-danger');
        }
      }
      
      if (node.type === 'items') {
        const fileParts = node.text.split('.');
        const fileExtension = fileParts[fileParts.length-1].toLowerCase();
        
        if ((bSupportRvt && fileExtension === 'rvt') ||
            (bSupportRfa && fileExtension === 'rfa') ||
            (bSupportRte && fileExtension === 'rte')) {
          filesToProcess.push({ node, destinationNode });
        }
      }
    }
    
    // Update UI with total files found
    if(filesToProcess.length > 0) {
      document.getElementById('upgradeTitle').innerHTML = 
        `<h4>Starting upgrade of ${filesToProcess.length} Revit files (Processing ${Math.min(FileLimitation, filesToProcess.length)} at a time)...</h4>`;
    }
    
    // Process files with queue management
    for(let i = 0; i < filesToProcess.length; i++) {
      if(i < FileLimitation) {
        // Process first batch immediately
        const { node, destinationNode } = filesToProcess[i];
        try {
          let upgradeInfo = await upgradeFileToFolder(node.id, destinationNode.id);
          workitemList.push(upgradeInfo.workItemId);
          addGroupListItem(node.text, upgradeInfo.workItemStatus, ItemType.FILE, 
                          'list-group-item-info', upgradeInfo.workItemId);
          fileNumber++;
        } catch (err) {
          addGroupListItem(node.text, 'failed', ItemType.FILE, 'list-group-item-danger');
          totalFilesProcessed++;
        }
      } else {
        // Add remaining files to queue
        fileQueue.push(filesToProcess[i]);
      }
    }
    
    // Update UI to show queue status
    if(fileQueue.length > 0) {
      console.log(`${fileQueue.length} files queued for processing`);
    }
  }, true);
}

function updateQueueStatus() {
  const activeCount = workitemList.length;
  const queuedCount = fileQueue.length;
  const processedCount = totalFilesProcessed;
  
  let statusText = `Processing: ${activeCount} active`;
  if(queuedCount > 0) {
    statusText += `, ${queuedCount} queued`;
  }
  statusText += `, ${processedCount} completed`;
  
  // You can add a status element to show this
  const statusElement = document.getElementById('queueStatus');
  if(statusElement) {
    statusElement.textContent = statusText;
  }
}

// Cancel bulk processing function
async function cancelBulkProcessing() {
  if (!currentBatchId) return;
  
  try {
    await jQuery.ajax({
      url: `/api/aps/da4revit/v1/upgrader/bulk/${currentBatchId}`,
      method: 'DELETE',
      dataType: 'json'
    });
    
    stopBulkProgressMonitoring();
    bulkProcessingActive = false;
    currentBatchId = null;
    
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    
    document.getElementById('upgradeTitle').innerHTML = "<h4>🛑 Bulk Processing Cancelled</h4>";
    addGroupListItem('Bulk Processing', 'Cancelled by user', ItemType.FOLDER, 'list-group-item-warning');
    
  } catch (error) {
    console.error('Error cancelling bulk processing:', error);
    addGroupListItem('Cancel Operation', 'Failed: ' + error.message, ItemType.FOLDER, 'list-group-item-danger');
  }
}

// Rest of the original functions remain unchanged...
function upgradeFileToFolder(sourceFile, destinateFolder){  
  let def = $.Deferred();

  if (sourceFile === null || destinateFolder === null ){
    def.reject('input parameters are null');
    return def.promise();
  }
  
  jQuery.post({
    url: '/api/aps/da4revit/v1/upgrader/files/'+encodeURIComponent(sourceFile)+'/folders/'+encodeURIComponent(destinateFolder),
    contentType: 'application/json',
    dataType: 'json',
    data: JSON.stringify({ 'sourceFile': sourceFile, 'destinateFolder': destinateFolder }),
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      def.reject(err);
    }
  });

  return def.promise();
}

function upgradeFile(node) {
  let def = $.Deferred();

  if (node === null) {
    def.reject('selected item is null');
    return def.promise();
  }

  const fileItemId   = node.id;
  const fileItemName = node.text;

  jQuery.post({
    url: '/api/aps/da4revit/v1/upgrader/files',
    contentType: 'application/json',
    dataType:'json',
    data: JSON.stringify({
      'fileItemId': fileItemId,
      'fileItemName': fileItemName
    }),
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      def.reject(err);
    }
  });
  return def.promise();
}

function prepareUserHubsTree( userHubs) {
  $(userHubs).jstree({
    'core': {
      'themes': { "icons": true },
      'multiple': false,
      'data': {
        "url": '/api/aps/datamanagement/v1',
        "dataType": "json",
        'cache': false,
        'data': function (node) {
          return { "id": node.id };
        }
      }
    },
    'types': {
      'default': {'icon': 'glyphicon glyphicon-question-sign'},
      '#': {'icon': 'glyphicon glyphicon-user'},
      'hubs': { 'icon': 'https://cdn.autodesk.io/dm/xs/a360hub.png' },
      'personalHub': { 'icon': 'https://cdn.autodesk.io/dm/xs/a360hub.png' },
      'bim360Hubs': { 'icon': 'https://cdn.autodesk.io/dm/xs/bim360hub.png' },
      'bim360projects': { 'icon': 'https://cdn.autodesk.io/dm/xs/bim360project.png' },
      'a360projects': { 'icon': 'https://cdn.autodesk.io/dm/xs/a360project.png' },
      'items': { 'icon': 'glyphicon glyphicon-file'},
      'folders': {'icon': 'glyphicon glyphicon-folder-open' },
      'versions': { 'icon': 'glyphicon glyphicon-time' },
      'unsupported': {'icon': 'glyphicon glyphicon-ban-circle'}
    },
    "plugins": ["types", "state", "sort", "contextmenu"],
    contextmenu: { items: (userHubs === '#sourceHubs'? autodeskCustomMenuSource: autodeskCustomMenuDestination)},
    "state": { "key": userHubs }
  }).bind("activate_node.jstree", function (evt, data) {
  });
}

function autodeskCustomMenuSource(autodeskNode) {
  var items;

  switch (autodeskNode.type) {
    case "items":
      items = {
        upgradeFile: {
          label: "Upgrade to Revit 2023",
          action: async function () {
            try{
              let logList = document.getElementById('logStatus');
              let index   = logList.childElementCount;
              while(index > 0){
                logList.removeChild(logList.firstElementChild);
                index--;
              }

              document.getElementById('upgradeTitle').innerHTML ="<h4>Start upgrading Revit files...</h4>";
              let upgradeInfo = await upgradeFile(autodeskNode);
              sourceNode = autodeskNode;
              workitemList.push(upgradeInfo.workItemId);
              document.getElementById('upgradeTitle').innerHTML ="<h4>Creating versions in BIM360...</h4>";
              addGroupListItem(autodeskNode.text, upgradeInfo.workItemStatus, ItemType.FILE, 'list-group-item-info', upgradeInfo.workItemId  );    
            }catch(err){
              addGroupListItem(autodeskNode.text, 'Failed', ItemType.FILE, 'list-group-item-danger' );
            }
        },
          icon: 'glyphicon glyphicon-transfer'
        }
      };
      break;
  }

  return items;
}

function autodeskCustomMenuDestination(autodeskNode) {
  var items;

  switch (autodeskNode.type) {
    case "folders":
      items = {
        createFolder: {
          label: "Create folder",
          action: function () {
            createFolder(autodeskNode);
          },
          icon: 'glyphicon glyphicon-folder-open'
        },
        deleteFolder: {
          label: "Delete folder",
          action: async function () {
            try{
              await deleteFolder(autodeskNode);
              let instance = $('#destinationHubs').jstree(true);
              selectNode = instance.get_selected(true)[0];
              parentNode = instance.get_parent(selectNode);
              instance.refresh_node(parentNode);
            }catch(err){
              alert("Failed to delete folder: " + autodeskNode.text )
            }
          },
          icon: 'glyphicon glyphicon-remove'
        }       
      };
      break;
  }

  return items;
}

function deleteFolder(node){
  let def = $.Deferred();

  if (node === null) {
    def.reject('selected node is not correct.');
    return def.promise();
  }

  $.ajax({
    url: '/api/aps/datamanagement/v1/folder/' + encodeURIComponent(node.id),
    type: "delete",
    dataType: "json",
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      console.log(err)
      def.reject(err);
    }
  });

  return def.promise();
}

async function createFolder(node) {
  if (node === null) {
    console.log('selected node is not correct.');
    return;
  }

  const folderName = prompt("Please specify the folder name:");
  if (folderName === null || folderName === '')
    return;

  try {
    await createNamedFolder(node, folderName);
  } catch (err) {
    alert("Failed to create folder: " + folderName )
  }

  let instance = $('#destinationHubs').jstree(true);
  let selectNode = instance.get_selected(true)[0];
  instance.refresh_node(selectNode);
}

function createNamedFolder(node, folderName) {
  let def = $.Deferred();

  if (node === null || folderName === null || folderName === '') {
    def.reject("parameters are not correct.");
    return def.promise();
  }

  jQuery.post({
    url: '/api/aps/datamanagement/v1/folder',
    contentType: 'application/json',
    dataType: 'json',
    data: JSON.stringify({
      'id': node.id,
      'name': folderName
    }),
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      console.log(err)
      def.reject(err);
    }
  });
  return def.promise();
}

function cancelWorkitem( workitemId ){
  let def = $.Deferred();

  if(workitemId === null || workitemId === ''){
    def.reject("parameters are not correct.");  
    return def.promise();
  }

  $.ajax({
    url: '/api/aps/da4revit/v1/upgrader/files/' + encodeURIComponent(workitemId),
    type: "delete",
    dataType: "json",
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      def.reject(err);
    }
  });
  return def.promise();
}

function getWorkitemStatus( workitemId ){
  let def = $.Deferred();

  if(workitemId === null || workitemId === ''){
    def.reject("parameters are not correct.");  
    return def.promise();
  }

  jQuery.get({
    url: '/api/aps/da4revit/v1/upgrader/files/' + encodeURIComponent(workitemId),
    dataType: 'json',
    success: function (res) {
      def.resolve(res);
    },
    error: function (err) {
      console.log(err)
      def.reject(err);
    }
  });
  return def.promise();
}

function updateListItem( itemId, statusStr){
  let item = document.getElementById(itemId+ LabelIdEndfix);
  if(item !== null){
    item.textContent = ', workitem is: '+ itemId+ ', status is:' + statusStr;
    const statusStrLowercase = statusStr.toLowerCase();
    if(statusStrLowercase === 'success' 
    || statusStrLowercase === 'cancelled'
    || statusStrLowercase === 'completed'
    || statusStrLowercase === 'failed'){
      let cancelBtn = document.getElementById(itemId+CancelIdEndfix);
      if( cancelBtn !== null ){
        cancelBtn.remove();
      }
      item.parentElement.setAttribute('class', (statusStr.toLowerCase() === 'completed')?'list-group-item-success':'list-group-item-warning');
    }
  }
}

function addGroupListItem(itemText, statusStr, itemType, itemStyle, itemId) {
  let li = document.createElement('li')
  li.setAttribute('class', 'list-group-item ' + itemStyle);

  let label = document.createElement('label');
  label.setAttribute('id', itemId + LabelIdEndfix);
  
  switch (itemType) {
    case ItemType.FILE:
      li.textContent = 'File:' + itemText;
      label.textContent = ', workitem is:' + itemId + ', status is:' + statusStr;
      li.appendChild(label)

      // Add cancel button for individual workitems (not bulk processing)
      if (itemId && itemId !== currentBatchId) {
        let spanCancel = document.createElement('span')
        spanCancel.setAttribute('class', 'btn btn-xs btn-default')
        spanCancel.setAttribute('id', itemId + CancelIdEndfix);
        spanCancel.onclick = async (e) => {
          const idParams = e.currentTarget.id.split('-')
          try {
            await cancelWorkitem(idParams[0]);
          } catch (err) {
            console.log('failed to cancel the workitem' + idParams[0]);
          }
        };
        spanCancel.textContent = 'Cancel';
        li.appendChild(spanCancel)
      }
      break;
      
    case ItemType.FOLDER:
      li.textContent = 'Folder:' + itemText;
      label.textContent = ', status is:' + statusStr;
      li.appendChild(label)
      
      // Add cancel button for bulk processing
      if (itemId === currentBatchId && bulkProcessingActive) {
        let spanCancel = document.createElement('span')
        spanCancel.setAttribute('class', 'btn btn-xs btn-danger')
        spanCancel.setAttribute('id', 'bulk-cancel');
        spanCancel.onclick = async (e) => {
          if (confirm('Are you sure you want to cancel bulk processing?')) {
            await cancelBulkProcessing();
          }
        };
        spanCancel.textContent = 'Cancel Bulk';
        li.appendChild(spanCancel)
      }
      break;
  }
  $('#logStatus')[0].appendChild(li);
}

function showUser() {
  jQuery.ajax({
    url: '/api/aps/user/v1/profile',
    success: function (profile) {
      var img = '<img src="' + profile.picture + '" height="20px">';
      $('#userInfo').html(img + profile.name);
    }
  });
}