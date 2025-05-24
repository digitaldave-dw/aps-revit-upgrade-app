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
socketio.on(SOCKET_TOPIC_WORKITEM, async (data)=>{
  console.log(data);
  updateListItem(data.WorkitemId, data.Status);
  if(data.Status.toLowerCase() === 'completed' || data.Status.toLowerCase() === 'failed' || data.Status.toLowerCase() === 'cancelled'){
    workitemList.pop(data.WorkitemId);
  }
  // Mark as finished when the workitemList is empty
  if(workitemList.length === 0 && !bulkProcessingActive){
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    document.getElementById('upgradeTitle').innerHTML = "<h4>✅ Upgrade Fully Completed!</h4>";

    // refresh the selected node
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

// New bulk processing function
async function startBulkProcessing(sourceNode, destinationNode, targetVersion) {
  try {
    bulkProcessingActive = true;
    
    // Extract folder and project IDs from the destination node
    const destinationParams = destinationNode.id.split('/');
    const folderId = destinationParams[destinationParams.length - 1];
    const projectId = destinationParams[destinationParams.length - 3];

    // Create file filter based on supported file types
    const supportedTypes = [];
    if (bSupportRvt) supportedTypes.push('rvt');
    if (bSupportRfa) supportedTypes.push('rfa');
    if (bSupportRte) supportedTypes.push('rte');

    console.log('Starting bulk processing:', {
      projectId: projectId,
      folderId: folderId,
      targetVersion: targetVersion,
      supportedTypes: supportedTypes
    });

    // Start bulk processing - FIXED payload structure
    const response = await jQuery.ajax({
      url: '/api/aps/da4revit/v1/upgrader/bulk',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        projectId: projectId,
        folderId: folderId,
        targetVersion: targetVersion,
        supportedTypes: supportedTypes  // This matches backend expectation
      })
    });

    if (response.success) {
      currentBatchId = response.batchId;
      addGroupListItem(`Bulk Processing Started`, `Processing ${response.totalFiles} files`, ItemType.FOLDER, 'list-group-item-info', currentBatchId);
      
      // Start progress monitoring
      startBulkProgressMonitoring();
      
      document.getElementById('upgradeTitle').innerHTML = `<h4>🔄 Processing ${response.totalFiles} files...</h4>`;
    } else {
      throw new Error(response.error || 'Failed to start bulk processing');
    }

  } catch (error) {
    console.error('Bulk processing error:', error);
    
    // Enhanced error reporting
    let errorMessage = 'Unknown error';
    if (error.responseJSON && error.responseJSON.error) {
      errorMessage = error.responseJSON.error;
    } else if (error.message) {
      errorMessage = error.message;
    } else if (error.statusText) {
      errorMessage = error.statusText;
    }
    
    addGroupListItem('Bulk Processing', 'Failed: ' + errorMessage, ItemType.FOLDER, 'list-group-item-danger');
    
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    bulkProcessingActive = false;
    document.getElementById('upgradeTitle').innerHTML = "<h4>❌ Bulk Processing Failed</h4>";
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
  // Clear existing file entries (keep the bulk processing entry)
  const logList = document.getElementById('logStatus');
  const entries = Array.from(logList.children);
  
  // Remove individual file entries but keep folder entries
  entries.forEach(entry => {
    if (entry.textContent.includes('File:') && !entry.textContent.includes('Bulk Processing')) {
      entry.remove();
    }
  });

  // Add current file statuses
  files.slice(0, 10).forEach(file => { // Show only first 10 files to avoid UI clutter
    const statusClass = getStatusClass(file.status);
    addGroupListItem(file.name, file.status.toUpperCase(), ItemType.FILE, statusClass, file.workItemId);
  });

  // Add summary if more than 10 files
  if (files.length > 10) {
    addGroupListItem(`... and ${files.length - 10} more files`, 'Processing', ItemType.FOLDER, 'list-group-item-info');
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
  
  let upgradeBtnElm = document.getElementById('upgradeBtn');
  upgradeBtnElm.disabled = false;
  
  const successCount = finalStatus.completedFiles || 0;
  const failedCount = finalStatus.failedFiles || 0;
  const totalCount = finalStatus.totalFiles || 0;
  
  if (failedCount === 0) {
    document.getElementById('upgradeTitle').innerHTML = `<h4>🎉 Bulk Processing Completed Successfully! (${successCount}/${totalCount} files)</h4>`;
  } else {
    document.getElementById('upgradeTitle').innerHTML = `<h4>⚠️ Bulk Processing Completed with ${failedCount} failures (${successCount}/${totalCount} files)</h4>`;
  }

  // Refresh tree nodes
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

// Original folder upgrade function (kept for legacy mode)
async function upgradeFolder(sourceNode, destinationNode) {
  if (sourceNode === null || sourceNode.type !== 'folders')
    return false;

  if (destinationNode === null || destinationNode.type !== 'folders')
    return false;

  let instance = $("#sourceHubs").jstree(true);
  instance.open_node(sourceNode, async function(e, data){
    let childrenDom = e.children;

    for (let i = 0; i < childrenDom.length; i++) {
      let nodeDom = childrenDom[i];
      let node = instance.get_json(nodeDom);
  
      if (node.type === 'folders') {
        let destinatedSubFolder = null;
        try {
          destinatedSubFolder = await createNamedFolder(destinationNode, node.text)
          addGroupListItem(node.text, 'created', ItemType.FOLDER, 'active' )
        } catch (err) {
          addGroupListItem(node.text, 'failed', ItemType.FOLDER, 'list-group-item-danger' )
        }
        try{
          await upgradeFolder(node, destinatedSubFolder);
        }catch(err){
          addGroupListItem(node.text,'failed', ItemType.FOLDER, 'list-group-item-danger' )
        }
      }
      if (node.type === 'items') {
        const fileParts     = node.text.split('.');
        const fileExtension = fileParts[fileParts.length-1].toLowerCase();
        if ((bSupportRvt && fileExtension === 'rvt') ||
          (bSupportRfa && fileExtension === 'rfa') ||
          (bSupportRte && fileExtension === 'rte')) {
          if (fileNumber++ >= FileLimitation) {
            addGroupListItem('File Limit Reached', `Only ${FileLimitation} files processed. Enable Bulk Processing for unlimited files.`, ItemType.FOLDER, 'list-group-item-warning');
            return;
          }
          try {
            let upgradeInfo = await upgradeFileToFolder(node.id, destinationNode.id);
            workitemList.push(upgradeInfo.workItemId);
            addGroupListItem(node.text, upgradeInfo.workItemStatus, ItemType.FILE, 'list-group-item-info', upgradeInfo.workItemId);
          } catch (err) {
            addGroupListItem(node.text, 'failed', ItemType.FILE, 'list-group-item-danger');
          }
        }
      }
    }
  
  }, true);
};

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