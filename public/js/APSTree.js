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

// Global variables
var bSupportRvt = true;
var bSupportRfa = true;
var bSupportRte = true;
var bIgnore     = true;
var bUpgrade2023= true;

const FileLimitation = 5; // Keep for legacy mode
var fileNumber = 0;

// Enhanced bulk processing variables
var currentBatchId = null;
var bulkProcessingActive = false;
var bulkProgressInterval = null;

var totalFilesProcessed = 0;
var fileQueue = [];
var isProcessingQueue = false;

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

// Initialize socket.io
socketio = io();

// Socket handlers
socketio.on(SOCKET_TOPIC_WORKITEM, async (data)=>{
  console.log(data);
  updateListItem(data.WorkitemId, data.Status);
  
  if(data.Status.toLowerCase() === 'completed' || 
     data.Status.toLowerCase() === 'failed' || 
     data.Status.toLowerCase() === 'cancelled'){
    
    const index = workitemList.findIndex(item => item === data.WorkitemId);
    if(index !== -1) {
      workitemList.splice(index, 1);
    }
    
    totalFilesProcessed++;
    
    if(workitemList.length < FileLimitation && fileQueue.length > 0) {
      processNextInQueue();
    }
  }
  
  if(workitemList.length === 0 && fileQueue.length === 0){
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    document.getElementById('upgradeTitle').innerHTML = 
      `<h4>Upgrade Fully Completed! (${totalFilesProcessed} files processed)</h4>`;

    fileNumber = 0;
    totalFilesProcessed = 0;
    
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

socketio.on(SOCKET_TOPIC_BULK_PROGRESS, (data) => {
  console.log('Bulk progress update:', data);
  updateBulkProgress(data);
});

// Add CSS for spinning animation and custom styles
const customStyles = `
<style>
.spinning {
    -webkit-animation: spin 1s linear infinite;
    -moz-animation: spin 1s linear infinite;
    animation: spin 1s linear infinite;
}

@-moz-keyframes spin { 100% { -moz-transform: rotate(360deg); } }
@-webkit-keyframes spin { 100% { -webkit-transform: rotate(360deg); } }
@keyframes spin { 100% { -webkit-transform: rotate(360deg); transform:rotate(360deg); } }

.analysis-panel {
    background-color: #1e3a5f;
    color: white;
    padding: 15px;
    border-radius: 5px;
    font-family: 'Consolas', 'Monaco', monospace;
    margin: 10px 0;
}

.analysis-header {
    color: #00bfff;
    font-size: 14px;
    margin-bottom: 10px;
    border-bottom: 1px solid #4a6fa5;
    padding-bottom: 5px;
}

.analysis-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 13px;
}

.analysis-label {
    flex: 1;
}

.analysis-value {
    text-align: right;
    min-width: 50px;
    font-weight: bold;
}

.analysis-icon {
    margin-left: 5px;
    font-size: 14px;
}

.icon-success { color: #28a745; }
.icon-info { color: #17a2b8; }
.icon-warning { color: #ffc107; }
.icon-danger { color: #dc3545; }
.icon-locked { color: #6c757d; }

/* Styles for workitem display */
.list-group-item small {
    font-size: 11px;
    line-height: 1.3;
}

.list-group-item label {
    margin-bottom: 0;
    font-weight: normal;
}

#logStatus .list-group-item {
    padding: 8px 10px;
    margin-bottom: 3px;
}

/* Progress bar animation */
.progress-bar {
    -webkit-transition: width 0.6s ease;
    -o-transition: width 0.6s ease;
    transition: width 0.6s ease;
}

/* Ensure progress bar is visible */
#projectUpgradeProgressBar {
    min-width: 2em;
}
</style>
`;

// Add styles to head if not already present
if (!$('#custom-apstree-styles').length) {
    $('head').append(`<div id="custom-apstree-styles">${customStyles}</div>`);
}

$(document).ready(function () {
  // Check if current visitor is signed in
  jQuery.ajax({
    url: '/api/aps/oauth/v1/token',
    success: function (res) {
      // User is signed in
      $('#autodeskSignOutButton').show();
      $('#autodeskSigninButton').hide();
      $('#refreshSourceHubs').show();
      $('#refreshDestinationHubs').show();

      // Prepare sign out
      $('#autodeskSignOutButton').click(function () {
        $('#hiddenFrame').on('load', function (event) {
          location.href = '/api/aps/oauth/v1/signout';
        });
        $('#hiddenFrame').attr('src', 'https://accounts.autodesk.com/Authentication/LogOut');
      });

      // Refresh buttons
      $('#refreshSourceHubs').click(function () {
        $('#sourceHubs').jstree(true).refresh();
      });

      $('#refreshDestinationHubs').click(function () {
        $('#destinationHubs').jstree(true).refresh();
      });

      prepareUserHubsTree('#sourceHubs');
      prepareUserHubsTree('#destinationHubs');
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
  });

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
    destinatedNode = $('#destinationHubs').jstree(true).get_selected(true)[0];
    if(destinatedNode === null){
      alert('Can not get the destinate folder, please make sure you select a folder as destination');
      return;
    }

    if(sourceNode.type !== 'folders' || destinatedNode.type !== 'folders'){
      alert('Currently only support upgrading files from folder to folder, please make sure select folder as source and destination.');
      return;
    }

    // Get upgrade settings
    bUpgrade2023 = $('input[name="upgradeToVersion"]:checked').val() === '2023';
    const targetVersion = $('input[name="upgradeToVersion"]:checked').val();
    bIgnore = $('input[name="fileExisted"]:checked').val() === 'skip';

    bSupportRvt = $('#supportRvtCbx')[0].checked;
    bSupportRfa = $('#supportRfaCbx')[0].checked;
    bSupportRte = $('#supportRteCbx')[0].checked;

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
      document.getElementById('upgradeTitle').innerHTML = "<h4>🚀 Starting Bulk Processing (No File Limit)...</h4>";
      await startBulkProcessing(sourceNode, destinatedNode, targetVersion);
    } else {
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

  // Initialize project upgrade functionality
  setTimeout(initializeProjectUpgrade, 1000);
});

/**
 * Create analysis panel with the requested format
 */
function createAnalysisPanel(stats, targetVersion, timeElapsed) {
  const panel = `
    <div class="analysis-panel">
      <div class="analysis-header">📊 File Analysis Complete (${timeElapsed}s):</div>
      
      <div class="analysis-row">
        <span class="analysis-label">Total files scanned:</span>
        <span class="analysis-value">${stats.totalFiles}</span>
      </div>
      
      <div class="analysis-row">
        <span class="analysis-label">Revit files found:</span>
        <span class="analysis-value">${stats.revitFiles || (stats.totalFiles || 0)}</span>
      </div>
      
      <hr style="margin: 5px 0; border-color: #4a6fa5;">
      
      <div class="analysis-row">
        <span class="analysis-label">Files needing upgrade:</span>
        <span class="analysis-value">${stats.needsUpgrade} <span class="analysis-icon icon-success">✓</span></span>
      </div>
      
      <div class="analysis-row">
        <span class="analysis-label">Already at Revit ${targetVersion}:</span>
        <span class="analysis-value">${stats.alreadyUpgraded} <span class="analysis-icon icon-info">■</span></span>
      </div>
      
      <div class="analysis-row">
        <span class="analysis-label">Workshared files skipped:</span>
        <span class="analysis-value">${stats.worksharedSkipped} <span class="analysis-icon icon-locked">🔒</span></span>
      </div>
      
      <div class="analysis-row">
        <span class="analysis-label">Unsupported types:</span>
        <span class="analysis-value">${stats.unsupportedTypes || 0} <span class="analysis-icon icon-danger">✗</span></span>
      </div>
      
      <div class="analysis-row">
        <span class="analysis-label">Version check errors:</span>
        <span class="analysis-value">${stats.checkErrors || 0} <span class="analysis-icon icon-warning">⚠</span></span>
      </div>
      
      <hr style="margin: 5px 0; border-color: #4a6fa5;">
    </div>
  `;
  
  return panel;
}

/**
 * Enhanced bulk processing with version detection feedback
 */
async function startBulkProcessing(sourceNode, destinationNode, targetVersion) {
  try {
    bulkProcessingActive = true;
    
    const sourceParams = sourceNode.id.split('/');
    const sourceFolderId = sourceParams[sourceParams.length - 1];
    const projectId = sourceParams[sourceParams.length - 3];

    const supportedTypes = [];
    if (bSupportRvt) supportedTypes.push('rvt');
    if (bSupportRfa) supportedTypes.push('rfa');
    if (bSupportRte) supportedTypes.push('rte');

    console.log('Starting optimized bulk processing:', {
      projectId: projectId,
      folderId: sourceFolderId,
      targetVersion: targetVersion,
      supportedTypes: supportedTypes
    });

    const logList = document.getElementById('logStatus');
    logList.innerHTML = '';
    
    // Show analyzing status
    addGroupListItem(
      'Bulk Processing', 
      'Analyzing folder and detecting file versions...', 
      ItemType.FOLDER, 
      'list-group-item-info',
      null,
      'bulk-analysis'
    );

    document.getElementById('upgradeTitle').innerHTML = 
      '<h4>🔍 Analyzing Files and Detecting Versions...</h4>';

    const startTime = Date.now();

    // Start bulk processing
    const response = await jQuery.ajax({
      url: '/api/aps/da4revit/v1/upgrader/bulk',
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify({
        projectId: projectId,
        folderId: sourceFolderId,
        targetVersion: targetVersion,
        supportedTypes: supportedTypes
      })
    });

    const analysisTime = ((Date.now() - startTime) / 1000).toFixed(1);

    if (response.success) {
      currentBatchId = response.batchId;
      
      logList.innerHTML = '';
      
      // Show analysis panel with the requested format
      if (response.stats) {
        const analysisPanel = createAnalysisPanel(response.stats, targetVersion, analysisTime);
        logList.insertAdjacentHTML('afterbegin', analysisPanel);
      }
      
      // Show performance gains
      if (response.stats && (response.stats.alreadyUpgraded > 0 || response.stats.worksharedSkipped > 0)) {
        const timeSaved = (response.stats.alreadyUpgraded + response.stats.worksharedSkipped) * 30;
        addGroupListItem(
          'Performance Optimization', 
          `Saved ~${Math.round(timeSaved / 60)} minutes by intelligent filtering`, 
          ItemType.FOLDER, 
          'list-group-item-success'
        );
      }
      
      // Show skipped files details if any
      if (response.skippedFiles && response.skippedFiles.alreadyUpgraded && response.skippedFiles.alreadyUpgraded.length > 0) {
        const firstFew = response.skippedFiles.alreadyUpgraded.slice(0, 3);
        firstFew.forEach(fileName => {
          addGroupListItem(
            `✓ ${fileName}`, 
            `Already Revit ${targetVersion}`, 
            ItemType.FILE, 
            'list-group-item-success'
          );
        });
        
        if (response.skippedFiles.alreadyUpgraded.length > 3) {
          addGroupListItem(
            `... and ${response.skippedFiles.alreadyUpgraded.length - 3} more already upgraded files`, 
            'SKIPPED', 
            ItemType.FOLDER, 
            'list-group-item-success'
          );
        }
      }
      
      // Start processing if files need upgrade
      if (response.filesToProcess > 0) {
        document.getElementById('upgradeTitle').innerHTML = 
          `<h4>🚀 Processing ${response.filesToProcess} files that need upgrade to Revit ${targetVersion}</h4>`;
          
        startBulkProgressMonitoring(currentBatchId);
      } else {
        document.getElementById('upgradeTitle').innerHTML = 
          `<h4>✅ All files are already up to date!</h4>`;
        bulkProcessingActive = false;
        let upgradeBtnElm = document.getElementById('upgradeBtn');
        upgradeBtnElm.disabled = false;
      }
      
    } else {
      throw new Error(response.error || 'Failed to start bulk processing');
    }

  } catch (error) {
    handleBulkProcessingError(error);
  }
}

/**
 * Handle bulk processing errors
 */
function handleBulkProcessingError(error) {
  console.error('Bulk processing error:', error);
  
  let errorMessage = 'Unknown error';
  
  if (error.responseJSON) {
    errorMessage = error.responseJSON.error || errorMessage;
    
    if (error.responseJSON.message && error.responseJSON.message.includes('No files need upgrading')) {
      const stats = error.responseJSON.stats;
      
      document.getElementById('logStatus').innerHTML = '';
      
      // Show analysis panel even for "no files need upgrade" case
      if (stats) {
        const analysisPanel = createAnalysisPanel(stats, error.responseJSON.targetVersion || '2023', '0.0');
        document.getElementById('logStatus').insertAdjacentHTML('afterbegin', analysisPanel);
      }
      
      addGroupListItem(
        'No Upgrade Needed', 
        'All files are already at the target version', 
        ItemType.FOLDER, 
        'list-group-item-success'
      );
      
      document.getElementById('upgradeTitle').innerHTML = 
        `<h4>✅ All files are up to date!</h4>`;
      
      let upgradeBtnElm = document.getElementById('upgradeBtn');
      upgradeBtnElm.disabled = false;
      bulkProcessingActive = false;
      return;
    }
  }
  
  addGroupListItem('Bulk Processing', 'Failed: ' + errorMessage, ItemType.FOLDER, 'list-group-item-danger');
  
  let upgradeBtnElm = document.getElementById('upgradeBtn');
  upgradeBtnElm.disabled = false;
  bulkProcessingActive = false;
  document.getElementById('upgradeTitle').innerHTML = `<h4>❌ Bulk Processing Failed: ${errorMessage}</h4>`;
}

/**
 * Monitor bulk processing progress
 */
function startBulkProgressMonitoring(batchId) {
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
  }
  
  bulkProgressInterval = setInterval(async () => {
    try {
      const status = await $.ajax({
        url: `/api/aps/da4revit/v1/upgrader/bulk/${batchId}/status`,
        method: 'GET',
        dataType: 'json'
      });
      
      updateBulkProgress(status);
      
      if (status.status === 'completed' || status.percentComplete === 100) {
        clearInterval(bulkProgressInterval);
        finishBulkProcessing(status);
      }
      
    } catch (error) {
      console.error('Error getting bulk status:', error);
    }
  }, 2000);
}

/**
 * Stop bulk progress monitoring
 */
function stopBulkProgressMonitoring() {
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
    bulkProgressInterval = null;
  }
}

/**
 * Update bulk processing progress
 */
function updateBulkProgress(data) {
  const titleElement = document.getElementById('upgradeTitle');
  const progressPercent = data.percentComplete || (data.totalFiles > 0 ? Math.round((data.completedFiles / data.totalFiles) * 100) : 0);
  
  titleElement.innerHTML = `
    <h4>📊 Processing Progress: ${data.completedFiles}/${data.totalFiles} files (${progressPercent}%)</h4>
    <div class="progress" style="margin: 10px 0; height: 25px;">
      <div class="progress-bar progress-bar-success progress-bar-striped active" 
           role="progressbar" 
           style="width: ${progressPercent}%; line-height: 25px;">
        ${progressPercent}%
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; font-size: 12px;">
      <span>✅ Completed: ${data.completedFiles}</span>
      <span>🔄 Processing: ${data.processingFiles || 0}</span>
      <span>⏳ Queued: ${data.queuedFiles || 0}</span>
      <span>❌ Failed: ${data.failedFiles || 0}</span>
    </div>
  `;

  // Check if processing is complete
  if (data.isComplete || progressPercent === 100) {
    finishBulkProcessing(data);
    return;
  }

  if (data.files && data.files.length > 0) {
    updateBulkFileList(data.files);
  }
  
  if (data.processingFiles > 0 && data.completedFiles > 0) {
    const avgTimePerFile = 30;
    const remainingFiles = data.totalFiles - data.completedFiles - data.failedFiles;
    const estimatedSeconds = remainingFiles * avgTimePerFile;
    const estimatedMinutes = Math.ceil(estimatedSeconds / 60);
    
    titleElement.innerHTML += `
      <div style="margin-top: 5px; font-size: 12px; color: #666;">
        Estimated time remaining: ~${estimatedMinutes} minutes
      </div>
    `;
  }
}

/**
 * Update bulk file list
 */
function updateBulkFileList(files) {
  const logList = document.getElementById('logStatus');
  
  // Keep the analysis panel at the top
  const analysisPanel = logList.querySelector('.analysis-panel');
  
  // Clear file entries but keep analysis panel
  const entries = Array.from(logList.children);
  entries.forEach(entry => {
    if (!entry.classList.contains('analysis-panel') && entry.getAttribute('data-file-status')) {
      entry.remove();
    }
  });

  const filesByStatus = {
    completed: files.filter(f => f.status === 'completed'),
    processing: files.filter(f => f.status === 'processing' || f.status === 'submitted'),
    queued: files.filter(f => f.status === 'queued'),
    failed: files.filter(f => f.status === 'failed')
  };

  // Show current processing files
  filesByStatus.processing.slice(0, 3).forEach(file => {
    const li = createFileStatusEntry(file.name, 'PROCESSING', 'list-group-item-info', file.workItemId);
    li.setAttribute('data-file-status', 'processing');
    logList.appendChild(li);
  });

  // Show recent completions
  filesByStatus.completed.slice(-5).reverse().forEach(file => {
    const li = createFileStatusEntry(file.name, 'COMPLETED', 'list-group-item-success', file.workItemId);
    li.setAttribute('data-file-status', 'completed');
    logList.appendChild(li);
  });

  // Show failures
  filesByStatus.failed.forEach(file => {
    const errorText = file.error ? `FAILED: ${file.error}` : 'FAILED';
    const li = createFileStatusEntry(file.name, errorText, 'list-group-item-danger', file.workItemId);
    li.setAttribute('data-file-status', 'failed');
    logList.appendChild(li);
  });

  // Show queue summary
  if (filesByStatus.queued.length > 0) {
    addGroupListItem(
      `⏳ ${filesByStatus.queued.length} files in queue`, 
      'Waiting to process', 
      ItemType.FOLDER, 
      'list-group-item-warning'
    );
  }
}

/**
 * Create file status entry
 */
function createFileStatusEntry(fileName, status, cssClass, workItemId) {
  const li = document.createElement('li');
  li.className = 'list-group-item ' + cssClass;
  li.style.padding = '5px 10px';
  li.style.fontSize = '12px';
  
  const timestamp = new Date().toLocaleTimeString();
  // Extract just the GUID from workitem ID
  const shortId = workItemId ? extractWorkitemGuid(workItemId) : '';
  
  li.innerHTML = `
    <span class="glyphicon glyphicon-file" style="margin-right: 5px;"></span>
    ${fileName}
    <span class="pull-right">${status}</span>
    <small class="text-muted" style="display: block; margin-top: 2px;">
      ${timestamp} ${shortId ? `(ID: ${shortId})` : ''}
    </small>
  `;
  
  return li;
}

/**
 * Extract GUID from full workitem ID
 */
function extractWorkitemGuid(fullId) {
  // If it's already just a GUID, return it
  if (!fullId.includes(':')) {
    return fullId;
  }
  // Extract GUID from ARN format: arn:adsk.wipprod:fs.workitem:GUID
  const parts = fullId.split(':');
  return parts[parts.length - 1];
}

/**
 * Finish bulk processing
 */
function finishBulkProcessing(finalStatus) {
  bulkProcessingActive = false;
  currentBatchId = null;
  
  stopBulkProgressMonitoring();
  
  let upgradeBtnElm = document.getElementById('upgradeBtn');
  upgradeBtnElm.disabled = false;
  
  const successCount = finalStatus.completedFiles || 0;
  const failedCount = finalStatus.failedFiles || 0;
  const totalCount = finalStatus.totalFiles || 0;
  
  let statusMessage, statusIcon, statusClass;
  
  if (failedCount === 0 && successCount === totalCount) {
    statusMessage = `All ${successCount} files upgraded successfully!`;
    statusIcon = '🎉';
    statusClass = 'success';
  } else if (successCount === 0) {
    statusMessage = `All ${totalCount} files failed to upgrade`;
    statusIcon = '❌';
    statusClass = 'danger';
  } else {
    statusMessage = `Completed with ${successCount} successes and ${failedCount} failures`;
    statusIcon = '⚠️';
    statusClass = 'warning';
  }
  
  document.getElementById('upgradeTitle').innerHTML = `
    <h4>${statusIcon} ${statusMessage}</h4>
    <div class="panel panel-${statusClass}" style="margin-top: 15px;">
      <div class="panel-heading">
        <h3 class="panel-title">Final Results</h3>
      </div>
      <div class="panel-body">
        <div class="row">
          <div class="col-md-3 text-center">
            <h3>${totalCount}</h3>
            <p>Total Files</p>
          </div>
          <div class="col-md-3 text-center">
            <h3 class="text-success">${successCount}</h3>
            <p>Successful</p>
          </div>
          <div class="col-md-3 text-center">
            <h3 class="text-danger">${failedCount}</h3>
            <p>Failed</p>
          </div>
          <div class="col-md-3 text-center">
            <h3 class="text-info">${Math.round((successCount / totalCount) * 100)}%</h3>
            <p>Success Rate</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('queueStatus').innerHTML = '';

  addGroupListItem(
    'Bulk Processing Complete', 
    statusMessage, 
    ItemType.FOLDER, 
    `list-group-item-${statusClass}`
  );

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
  }, 2000);
}

/**
 * Cancel bulk processing
 */
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

/**
 * Process next file in queue
 */
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
        
        if(fileQueue.length > 0) {
          setTimeout(() => processNextInQueue(), 100);
        }
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Original folder upgrade function (legacy mode)
 */
async function upgradeFolder(sourceNode, destinationNode) {
  if (sourceNode === null || sourceNode.type !== 'folders')
    return false;

  if (destinationNode === null || destinationNode.type !== 'folders')
    return false;

  fileQueue = [];
  
  let instance = $("#sourceHubs").jstree(true);
  instance.open_node(sourceNode, async function(e, data){
    let childrenDom = e.children;
    
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
    
    if(filesToProcess.length > 0) {
      document.getElementById('upgradeTitle').innerHTML = 
        `<h4>Starting upgrade of ${filesToProcess.length} Revit files (Processing ${Math.min(FileLimitation, filesToProcess.length)} at a time)...</h4>`;
    }
    
    for(let i = 0; i < filesToProcess.length; i++) {
      if(i < FileLimitation) {
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
        fileQueue.push(filesToProcess[i]);
      }
    }
    
    if(fileQueue.length > 0) {
      console.log(`${fileQueue.length} files queued for processing`);
    }
  }, true);
}

// API Functions
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

function prepareUserHubsTree(userHubs) {
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
      'workshared-item': { 'icon': 'glyphicon glyphicon-lock' },  
      'folders': {'icon': 'glyphicon glyphicon-folder-open' },
      'versions': { 'icon': 'glyphicon glyphicon-time' },
      'unsupported': {'icon': 'glyphicon glyphicon-ban-circle'}
    },
    "plugins": ["types", "state", "sort", "contextmenu"],
    contextmenu: { items: (userHubs === '#sourceHubs'? autodeskCustomMenuSource: autodeskCustomMenuDestination)},
    "state": { "key": userHubs }
  }).bind("activate_node.jstree", function (evt, data) {
    if (data.node.type === 'workshared-item') {
      console.log('Selected a workshared file - cannot be upgraded');
    }
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
              addGroupListItem(autodeskNode.text, upgradeInfo.workItemStatus, ItemType.FILE, 'list-group-item-info', upgradeInfo.workItemId);    
            }catch(err){
              addGroupListItem(autodeskNode.text, 'Failed', ItemType.FILE, 'list-group-item-danger');
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

function updateListItem(itemId, statusStr){
  let item = document.getElementById(itemId + LabelIdEndfix);
  if(item !== null){
    const shortId = extractWorkitemGuid(itemId);
    item.textContent = ', workitem: '+ shortId + ', status: ' + statusStr;
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

function addGroupListItem(itemText, statusStr, itemType, itemStyle, itemId, elementId) {
  let li = document.createElement('li');
  li.setAttribute('class', 'list-group-item ' + itemStyle);
  
  if (elementId) {
    li.setAttribute('id', elementId);
  }

  let label = document.createElement('label');
  label.setAttribute('id', itemId + LabelIdEndfix);
  
  switch (itemType) {
    case ItemType.FILE:
      li.textContent = 'File:' + itemText;
      if (itemId) {
        const shortId = extractWorkitemGuid(itemId);
        label.textContent = ', workitem: ' + shortId + ', status: ' + statusStr;
      } else {
        label.textContent = ', status: ' + statusStr;
      }
      li.appendChild(label);

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
      label.textContent = ', status: ' + statusStr;
      li.appendChild(label);
      
      if (currentBatchId && bulkProcessingActive && itemText.includes('Processing')) {
        let spanCancel = document.createElement('span');
        spanCancel.setAttribute('class', 'btn btn-xs btn-danger pull-right');
        spanCancel.setAttribute('id', 'bulk-cancel');
        spanCancel.onclick = async (e) => {
          if (confirm('Are you sure you want to cancel bulk processing?')) {
            await cancelBulkProcessing();
          }
        };
        spanCancel.textContent = 'Cancel All';
        li.appendChild(spanCancel);
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

/**
 * Initialize project upgrade UI components
 */
function initializeProjectUpgrade() {
  const upgradeButton = `
    <button class="btn btn-primary" id="projectUpgradeBtn" style="margin-left: 10px;">
      <span class="glyphicon glyphicon-transfer"></span> Upgrade Entire Project
    </button>
  `;
  
  $('#upgradeBtn').after(upgradeButton);
  
  const modalHtml = `
    <div class="modal fade" id="projectUpgradeModal" tabindex="-1" role="dialog">
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
            <h4 class="modal-title">Project-to-Project Upgrade</h4>
          </div>
          <div class="modal-body">
            <div class="alert alert-info">
              <strong>How it works:</strong> 
              <ul style="margin-bottom: 0;">
                <li><strong>Same Project (In-Place):</strong> Creates new versions of all Revit files within the current project</li>
                <li><strong>Different Projects:</strong> Copies files to destination project and upgrades them</li>
              </ul>
            </div>
            
            <div class="row">
              <div class="col-md-6">
                <div class="form-group">
                  <label for="sourceProject">Source Project:</label>
                  <select class="form-control" id="sourceProject">
                    <option value="">Loading projects...</option>
                  </select>
                  <small class="text-muted">Select the project containing files to upgrade</small>
                </div>
              </div>
              <div class="col-md-6">
                <div class="form-group">
                  <label for="destinationProject">Destination Project:</label>
                  <select class="form-control" id="destinationProject">
                    <option value="">Loading projects...</option>
                  </select>
                  <small class="text-muted">Select same project for in-place upgrade or different project to copy</small>
                </div>
              </div>
            </div>
            
            <div id="upgradeMode"></div>
            
            <div class="row">
              <div class="col-md-6">
                <div class="form-group">
                  <label>Target Revit Version:</label>
                  <div class="radio">
                    <label>
                      <input type="radio" name="projectTargetVersion" value="2023" checked>
                      Revit 2023
                    </label>
                  </div>
                  <div class="radio">
                    <label>
                      <input type="radio" name="projectTargetVersion" value="2024">
                      Revit 2024
                    </label>
                  </div>
                </div>
              </div>
              <div class="col-md-6">
                <div class="form-group">
                  <label>Options:</label>
                  <div class="checkbox">
                    <label>
                      <input type="checkbox" id="maintainStructure" checked>
                      Maintain folder structure
                    </label>
                  </div>
                  <div class="checkbox">
                    <label>
                      <input type="checkbox" id="skipExisting">
                      Skip existing files
                    </label>
                  </div>
                  <div class="checkbox">
                    <label>
                      <input type="checkbox" id="includeWorkshared">
                      Include workshared files (not recommended)
                    </label>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="row">
              <div class="col-md-12">
                <div id="projectAnalysisResult" style="display: none;">
                  <h5>Analysis Result:</h5>
                  <div id="analysisContent"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" data-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-info" id="analyzeProjectBtn">
              <span class="glyphicon glyphicon-search"></span> Analyze Source
            </button>
            <button type="button" class="btn btn-primary" id="startProjectUpgradeBtn" disabled>
              <span class="glyphicon glyphicon-play"></span> Start Upgrade
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Enhanced Progress Modal -->
    <div class="modal fade" id="projectUpgradeProgressModal" tabindex="-1" role="dialog" data-backdrop="static">
      <div class="modal-dialog modal-lg" role="document">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title">Project Upgrade Progress</h4>
          </div>
          <div class="modal-body">
            <div id="upgradeModeSummary"></div>
            
            <div id="projectAnalysisPanel"></div>
            
            <div class="progress">
              <div id="projectUpgradeProgressBar" class="progress-bar progress-bar-striped active" 
                   role="progressbar" style="width: 0%">
                <span class="sr-only">0% Complete</span>
              </div>
            </div>
            
            <div id="projectUpgradeStats" style="margin-top: 20px;">
              <div class="row">
                <div class="col-md-3 text-center">
                  <h3 id="totalFilesCount">0</h3>
                  <p>Total Files</p>
                </div>
                <div class="col-md-3 text-center">
                  <h3 id="completedFilesCount" class="text-success">0</h3>
                  <p>Completed</p>
                </div>
                <div class="col-md-3 text-center">
                  <h3 id="processingFilesCount" class="text-info">0</h3>
                  <p>Processing</p>
                </div>
                <div class="col-md-3 text-center">
                  <h3 id="failedFilesCount" class="text-danger">0</h3>
                  <p>Failed</p>
                </div>
              </div>
            </div>
            
            <div id="projectUpgradeLog" style="max-height: 300px; overflow-y: auto; margin-top: 20px;">
              <h5>Processing Log:</h5>
              <div id="logContent"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-warning" id="cancelProjectUpgradeBtn">
              <span class="glyphicon glyphicon-stop"></span> Cancel
            </button>
            <button type="button" class="btn btn-success" id="closeProgressBtn" style="display: none;">
              <span class="glyphicon glyphicon-ok"></span> Close
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  $('body').append(modalHtml);
  
  setupProjectUpgradeHandlers();
}

/**
 * Setup project upgrade event handlers
 */
function setupProjectUpgradeHandlers() {
  $('#projectUpgradeBtn').click(function() {
    $('#projectUpgradeModal').modal('show');
    loadAvailableProjects();
  });
  
  $('#analyzeProjectBtn').click(analyzeSourceProject);
  
  $('#startProjectUpgradeBtn').click(startProjectUpgrade);
  
  $('#cancelProjectUpgradeBtn').click(cancelProjectUpgrade);
  
  // FIXED: Add handler for close button
  $('#closeProgressBtn').click(function() {
    $('#projectUpgradeProgressModal').modal('hide');
    
    if (window.projectUpgradeInterval) {
      clearInterval(window.projectUpgradeInterval);
      window.projectUpgradeInterval = null;
    }
    
    resetProjectUpgradeUI();
  });
  
  $('#sourceProject, #destinationProject').change(validateProjectSelection);
  
  $('#projectUpgradeProgressModal').on('hidden.bs.modal', function() {
    if (window.projectUpgradeInterval) {
      clearInterval(window.projectUpgradeInterval);
      window.projectUpgradeInterval = null;
    }
  });
}

/**
 * Reset project upgrade UI
 */
function resetProjectUpgradeUI() {
  $('#projectUpgradeProgressBar').css('width', '0%').text('0%');
  $('#totalFilesCount').text('0');
  $('#completedFilesCount').text('0');
  $('#processingFilesCount').text('0');
  $('#failedFilesCount').text('0');
  $('#logContent').empty();
  $('#projectAnalysisPanel').empty();
  $('#cancelProjectUpgradeBtn').show();
  $('#closeProgressBtn').hide();
  window.currentProjectUpgradeBatchId = null;
}

/**
 * Load available projects
 */
async function loadAvailableProjects() {
  try {
    const response = await $.ajax({
      url: '/api/aps/da4revit/v1/upgrader/projects',
      method: 'GET'
    });
    
    const projectOptions = '<option value="">-- Select a project --</option>' +
      response.projects.map(project => {
        const fullProjectId = project.id.startsWith('b.') ? project.id : `b.${project.id}`;
        
        return `<option value="${fullProjectId}" data-hub="${project.hubId}">
          ${project.name} (${project.hubName})
        </option>`;
      }).join('');
      
    $('#sourceProject, #destinationProject').html(projectOptions);
    
  } catch (error) {
    console.error('Failed to load projects:', error);
  }
}

/**
 * Validate project selection
 */
function validateProjectSelection() {
  const sourceId = $('#sourceProject').val();
  const destId = $('#destinationProject').val();
  
  if (sourceId && destId) {
    if (sourceId === destId) {
      $('#upgradeMode').html(`
        <div class="alert alert-info" style="margin-top: 10px;">
          <strong>In-Place Upgrade Mode:</strong> Files will be upgraded within the same project. 
          New versions will be created for each file while preserving the original folder structure.
        </div>
      `);
      
      $('#maintainStructure').prop('checked', true).prop('disabled', true);
      $('#maintainStructure').closest('.checkbox').addClass('text-muted');
      
      $('#startProjectUpgradeBtn').html(
        '<span class="glyphicon glyphicon-refresh"></span> Upgrade In Place'
      );
      
    } else {
      $('#upgradeMode').html(`
        <div class="alert alert-success" style="margin-top: 10px;">
          <strong>Cross-Project Upgrade Mode:</strong> Files will be copied from source to destination 
          project and upgraded. Original files remain unchanged.
        </div>
      `);
      
      $('#maintainStructure').prop('disabled', false);
      $('#maintainStructure').closest('.checkbox').removeClass('text-muted');
      
      $('#startProjectUpgradeBtn').html(
        '<span class="glyphicon glyphicon-transfer"></span> Copy & Upgrade'
      );
    }
    
    $('#startProjectUpgradeBtn').prop('disabled', false);
    
  } else {
    $('#upgradeMode').empty();
    $('#startProjectUpgradeBtn').prop('disabled', true);
  }
}

/**
 * Analyze source project
 */
async function analyzeSourceProject() {
  const sourceId = $('#sourceProject').val();
  const destId = $('#destinationProject').val();
  const targetVersion = $('input[name="projectTargetVersion"]:checked').val();
  
  if (!sourceId) {
    showAlert('Please select a source project first.', 'warning');
    return;
  }
  
  const isInPlaceUpgrade = sourceId === destId;
  
  $('#analyzeProjectBtn').prop('disabled', true).html(
    '<span class="glyphicon glyphicon-refresh spinning"></span> Analyzing...'
  );
  
  try {
    // Make actual API call to analyze the project
    const response = await $.ajax({
      url: '/api/aps/da4revit/v1/upgrader/project/analyze',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify({
        sourceProjectId: sourceId,
        destinationProjectId: destId || sourceId,
        targetVersion: targetVersion,
        includeWorkshared: $('#includeWorkshared').is(':checked')
      })
    });
    
    // Use real data from response
    const analysisHtml = `
      <div class="well">
        <strong>Upgrade Mode:</strong> ${isInPlaceUpgrade ? 
          'In-Place (creating new versions)' : 
          'Cross-Project (copying to destination)'}
        <br><br>
        
        <div class="row">
          <div class="col-md-6">
            <strong>Source project contains:</strong>
            <ul>
              <li>${response.totalFolders || 0} folders</li>
              <li>${response.totalFiles || 0} Revit files total
                <ul>
                  <li>${response.filesByType?.rvt || 0} RVT files</li>
                  <li>${response.filesByType?.rfa || 0} RFA files</li>
                  <li>${response.filesByType?.rte || 0} RTE files</li>
                </ul>
              </li>
            </ul>
          </div>
          <div class="col-md-6">
            <strong>Upgrade Analysis:</strong>
            <ul>
              <li class="text-success">${response.needsUpgrade || 0} files need upgrade to Revit ${targetVersion}</li>
              <li class="text-muted">${response.alreadyUpgraded || 0} files already at Revit ${targetVersion}</li>
              <li class="text-warning">${response.worksharedFiles || 0} workshared files (${$('#includeWorkshared').is(':checked') ? 'will be included' : 'will be skipped'})</li>
            </ul>
            ${response.needsUpgrade > 0 ? `
            <div class="alert alert-success" style="margin-top: 10px;">
              <strong>Optimization:</strong> Only ${response.needsUpgrade} files will be processed, 
              saving approximately ${Math.round((response.alreadyUpgraded || 0) * 0.5)} minutes.
            </div>
            ` : `
            <div class="alert alert-info" style="margin-top: 10px;">
              <strong>All files are up to date!</strong> No upgrade needed.
            </div>
            `}
          </div>
        </div>
        
        <strong>What will happen:</strong>
        <ul>
          ${isInPlaceUpgrade ? `
            <li>Each file will get a new version in its current location</li>
            <li>Original versions will be preserved in version history</li>
            <li>No files will be moved or copied</li>
            <li>All metadata and permissions will be retained</li>
          ` : `
            <li>Files will be copied to the destination project</li>
            <li>Folder structure will be ${$('#maintainStructure').is(':checked') ? 'recreated' : 'flattened'}</li>
            <li>Original files will remain unchanged</li>
            <li>New items will be created in destination</li>
          `}
        </ul>
        <strong>Estimated time:</strong> ${response.estimatedTime || `~${Math.ceil((response.needsUpgrade || 0) * 0.5)} minutes`}
      </div>
    `;
    
    $('#analysisContent').html(analysisHtml);
    $('#projectAnalysisResult').show();
    
  } catch (error) {
    console.log('Analysis endpoint not available, using estimation...');
    
    // If endpoint doesn't exist, provide a reasonable estimation
    const analysisHtml = `
      <div class="well">
        <div class="alert alert-info">
          <strong>Note:</strong> This is an estimation. Actual file counts will be determined during processing.
        </div>
        <strong>Upgrade Mode:</strong> ${isInPlaceUpgrade ? 
          'In-Place (creating new versions)' : 
          'Cross-Project (copying to destination)'}
        <br><br>
        
        <strong>What will happen:</strong>
        <ul>
          ${isInPlaceUpgrade ? `
            <li>All Revit files (RVT, RFA, RTE) in the project will be analyzed</li>
            <li>Only files needing upgrade to Revit ${targetVersion} will be processed</li>
            <li>New versions will be created in their current locations</li>
            <li>Original versions will be preserved in version history</li>
          ` : `
            <li>All Revit files will be copied to the destination project</li>
            <li>Only files needing upgrade will be processed</li>
            <li>Folder structure will be ${$('#maintainStructure').is(':checked') ? 'maintained' : 'flattened'}</li>
            <li>Original files will remain unchanged</li>
          `}
        </ul>
        
        <div class="alert alert-success">
          <strong>Performance Optimization:</strong><br>
          • Files already at Revit ${targetVersion} will be automatically skipped<br>
          • Workshared files will be ${$('#includeWorkshared').is(':checked') ? 'included' : 'excluded'}<br>
          • Version detection will minimize unnecessary processing
        </div>
      </div>
    `;
    
    $('#analysisContent').html(analysisHtml);
    $('#projectAnalysisResult').show();
    
  } finally {
    $('#analyzeProjectBtn').prop('disabled', false).html(
      '<span class="glyphicon glyphicon-search"></span> Analyze Source'
    );
  }
}

/**
 * Start project upgrade
 */
async function startProjectUpgrade() {
  const sourceProjectId = $('#sourceProject').val();
  const destinationProjectId = $('#destinationProject').val();
  const targetVersion = $('input[name="projectTargetVersion"]:checked').val();
  
  if (!sourceProjectId || !destinationProjectId) {
    showAlert('Please select both source and destination projects.', 'warning');
    return;
  }
  
  const requestData = {
    sourceProjectId,
    destinationProjectId,
    targetVersion,
    maintainStructure: $('#maintainStructure').is(':checked'),
    skipExisting: $('#skipExisting').is(':checked'),
    includeWorkshared: $('#includeWorkshared').is(':checked')
  };
  
  try {
    $('#startProjectUpgradeBtn').prop('disabled', true).html(
      '<span class="glyphicon glyphicon-refresh spinning"></span> Starting...'
    );
    
    const response = await $.ajax({
      url: '/api/aps/da4revit/v1/upgrader/project',
      method: 'POST',
      contentType: 'application/json',
      data: JSON.stringify(requestData)
    });
    
    if (response.success) {
      window.currentProjectUpgradeBatchId = response.batchId;
      
      $('#projectUpgradeModal').modal('hide');
      $('#projectUpgradeProgressModal').modal('show');
      
      $('#totalFilesCount').text(response.summary.totalFiles);
      
      // Show analysis panel in progress modal
      if (response.stats) {
        const analysisPanel = createAnalysisPanel(
          response.stats, 
          targetVersion, 
          response.performance?.analysisTime || '0.0'
        );
        $('#projectAnalysisPanel').html(analysisPanel);
      }
      
      addLogEntry(`Started ${response.upgradeMode} upgrade of ${response.summary.totalFiles} files to Revit ${targetVersion}`);
      addLogEntry(`Batch ID: ${response.batchId}`);
      
      if (response.breakdown) {
        addLogEntry(`Skipped ${response.breakdown.alreadyUpgraded} files already at target version`, 'info');
        if (response.breakdown.worksharedSkipped > 0) {
          addLogEntry(`Skipped ${response.breakdown.worksharedSkipped} workshared files`, 'warning');
        }
      }
      
      startProgressPolling(response.batchId);
    }
    
  } catch (error) {
    console.error('Failed to start project upgrade:', error);
    showAlert('Failed to start project upgrade. ' + (error.responseJSON?.error || ''), 'danger');
  } finally {
    $('#startProjectUpgradeBtn').prop('disabled', false).html(
      '<span class="glyphicon glyphicon-play"></span> Start Upgrade'
    );
  }
}

/**
 * Poll for progress
 */
function startProgressPolling(batchId) {
  if (window.projectUpgradeInterval) {
    clearInterval(window.projectUpgradeInterval);
  }
  
  // Poll every 2 seconds
  window.projectUpgradeInterval = setInterval(async () => {
    try {
      const status = await $.ajax({
        url: `/api/aps/da4revit/v1/upgrader/bulk/${batchId}/status`,
        method: 'GET'
      });
      
      updateProgressDisplay(status);
      
      // Check if complete
      if (status.status === 'completed' || status.percentComplete === 100) {
        clearInterval(window.projectUpgradeInterval);
        window.projectUpgradeInterval = null;
        onUpgradeComplete(status);
      }
      
    } catch (error) {
      console.error('Failed to get upgrade status:', error);
    }
  }, 2000);
}

/**
 * Update progress display
 */
function updateProgressDisplay(status) {
  // Calculate percent - handle both percentComplete and manual calculation
  const percent = status.percentComplete || (status.totalFiles > 0 ? Math.round(((status.completedFiles || 0) / status.totalFiles) * 100) : 0);
  
  // Update progress bar with animation
  $('#projectUpgradeProgressBar')
    .css('width', percent + '%')
    .attr('aria-valuenow', percent)
    .text(percent + '%');
  
  // Update counters
  $('#completedFilesCount').text(status.completedFiles || 0);
  $('#processingFilesCount').text(status.processingFiles || 0);
  $('#failedFilesCount').text(status.failedFiles || 0);
  
  // Update mode summary if not already set
  if (status.projectInfo && $('#upgradeModeSummary').is(':empty')) {
    const isInPlace = status.projectInfo.sourceProject === status.projectInfo.destinationProject;
    const modeSummary = `
      <div class="well well-sm" style="margin-bottom: 10px;">
        <strong>Mode:</strong> ${isInPlace ? 'In-Place Upgrade' : 'Cross-Project Upgrade'}<br>
        <strong>Target Version:</strong> Revit ${status.targetVersion || '2023'}
      </div>
    `;
    $('#upgradeModeSummary').html(modeSummary);
  }
  
  // Initialize processed files tracking
  if (!window.processedFiles) {
    window.processedFiles = new Set();
  }
  
  // Add log entries for status changes
  if (status.files) {
    status.files.forEach(file => {
      const fileKey = `${file.name}_${file.status}`;
      
      if (!window.processedFiles.has(fileKey)) {
        if (file.status === 'completed') {
          const action = status.upgradeMode === 'in-place' ? 'version created' : 'copied & upgraded';
          addLogEntry(`✓ Completed: ${file.name} (${action})`, 'success');
          window.processedFiles.add(fileKey);
        } else if (file.status === 'failed') {
          addLogEntry(`✗ Failed: ${file.name} - ${file.error || 'Unknown error'}`, 'danger');
          window.processedFiles.add(fileKey);
        }
      }
    });
  }
  
  // Update time remaining
  if (status.estimatedTimeRemaining && percent < 100) {
    updateTimeRemaining(status.estimatedTimeRemaining);
  }
}

/**
 * Update time remaining
 */
function updateTimeRemaining(timeRemaining) {
  const existingTimeEntry = $('#logContent').find('.time-remaining');
  if (existingTimeEntry.length > 0) {
    existingTimeEntry.text(`[${new Date().toLocaleTimeString()}] Estimated time remaining: ${timeRemaining}`);
  } else {
    addLogEntry(`Estimated time remaining: ${timeRemaining}`, 'info', false, 'time-remaining');
  }
}

/**
 * Handle upgrade completion
 */
function onUpgradeComplete(status) {
  window.processedFiles = null;
  
  $('#projectUpgradeProgressBar')
    .removeClass('active')
    .addClass(status.failedFiles > 0 ? 'progress-bar-warning' : 'progress-bar-success');
  
  $('#cancelProjectUpgradeBtn').hide();
  $('#closeProgressBtn').show();
  
  let message = `Upgrade complete! Successfully processed ${status.completedFiles} files.`;
  if (status.failedFiles > 0) {
    message += ` ${status.failedFiles} files failed.`;
  }
  
  addLogEntry(message, status.failedFiles > 0 ? 'warning' : 'success');
  
  showAlert(message, status.failedFiles > 0 ? 'warning' : 'success', 10000);
}

/**
 * Cancel project upgrade
 */
async function cancelProjectUpgrade() {
  if (!window.currentProjectUpgradeBatchId) return;
  
  if (!confirm('Are you sure you want to cancel the upgrade process?')) {
    return;
  }
  
  try {
    await $.ajax({
      url: `/api/aps/da4revit/v1/upgrader/bulk/${window.currentProjectUpgradeBatchId}`,
      method: 'DELETE'
    });
    
    clearInterval(window.projectUpgradeInterval);
    addLogEntry('Upgrade cancelled by user', 'warning');
    $('#cancelProjectUpgradeBtn').hide();
    $('#closeProgressBtn').show();
    
  } catch (error) {
    console.error('Failed to cancel upgrade:', error);
    showAlert('Failed to cancel upgrade process.', 'danger');
  }
}

/**
 * Add log entry
 */
function addLogEntry(message, type = 'info', replace = false, additionalClass = '') {
  const timestamp = new Date().toLocaleTimeString();
  const typeClass = {
    'info': 'text-info',
    'success': 'text-success',
    'warning': 'text-warning',
    'danger': 'text-danger'
  }[type] || '';
  
  const classes = `${typeClass} ${additionalClass}`.trim();
  const entry = `<div class="${classes}">[${timestamp}] ${message}</div>`;
  
  if (replace && $('#logContent').children().last().hasClass(typeClass)) {
    $('#logContent').children().last().replaceWith(entry);
  } else {
    $('#logContent').append(entry);
  }
  
  $('#projectUpgradeLog').scrollTop($('#projectUpgradeLog')[0].scrollHeight);
}

/**
 * Show alert
 */
function showAlert(message, type = 'info', duration = 5000) {
  const alertId = 'alert-' + Date.now();
  const alertHtml = `
    <div id="${alertId}" class="alert alert-${type} alert-dismissible fade in" role="alert" style="position: fixed; top: 70px; right: 20px; z-index: 9999; max-width: 400px;">
      <button type="button" class="close" data-dismiss="alert" aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
      ${message}
    </div>
  `;
  
  $('body').append(alertHtml);
  
  setTimeout(() => {
    $(`#${alertId}`).fadeOut(() => $(`#${alertId}`).remove());
  }, duration);
}