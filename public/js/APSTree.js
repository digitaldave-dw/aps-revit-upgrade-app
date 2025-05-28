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

/**
 * Initialize project upgrade UI components
 * This sets up the modal dialog and event handlers for project selection
 */
function initializeProjectUpgrade() {
    // Add the project upgrade button to your UI
    const upgradeButton = `
        <button class="btn btn-primary" id="projectUpgradeBtn" style="margin-left: 10px;">
            <span class="glyphicon glyphicon-transfer"></span> Upgrade Entire Project
        </button>
    `;
    
    // Add button next to existing upgrade button
    $('#upgradeBtn').after(upgradeButton);
    
    // Create the project selection modal
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
                            <strong>How it works:</strong> This feature will upgrade all Revit files from the source project 
                            to the selected Revit version and save them in the destination project, maintaining the folder structure.
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
                                    <small class="text-muted">Select where upgraded files will be saved</small>
                                </div>
                            </div>
                        </div>
                        
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
                                            <input type="checkbox" id="skipExisting" checked>
                                            Skip existing files
                                        </label>
                                    </div>
                                    <div class="checkbox">
                                        <label>
                                            <input type="checkbox" id="includeWorkshared">
                                            Include workshared files
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
        
        <!-- Progress Modal -->
        <div class="modal fade" id="projectUpgradeProgressModal" tabindex="-1" role="dialog" data-backdrop="static">
            <div class="modal-dialog modal-lg" role="document">
                <div class="modal-content">
                    <div class="modal-header">
                        <h4 class="modal-title">Project Upgrade Progress</h4>
                    </div>
                    <div class="modal-body">
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
                        <button type="button" class="btn btn-default" id="closeProgressBtn" style="display: none;">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add modals to body
    $('body').append(modalHtml);
    
    // Setup event handlers
    setupProjectUpgradeHandlers();
}

/**
 * Setup all event handlers for project upgrade functionality
 */
function setupProjectUpgradeHandlers() {
    // Open modal button
    $('#projectUpgradeBtn').click(function() {
        $('#projectUpgradeModal').modal('show');
        loadAvailableProjects();
    });
    
    // Analyze project button
    $('#analyzeProjectBtn').click(analyzeSourceProject);
    
    // Start upgrade button
    $('#startProjectUpgradeBtn').click(startProjectUpgrade);
    
    // Cancel upgrade button
    $('#cancelProjectUpgradeBtn').click(cancelProjectUpgrade);
    
    // Project selection validation
    $('#sourceProject, #destinationProject').change(validateProjectSelection);
}

/**
 * Load available projects for selection
 */
async function loadAvailableProjects() {
    try {
        const response = await $.ajax({
            url: '/api/aps/da4revit/v1/upgrader/projects',
            method: 'GET'
        });
        
        // When populating the dropdown, ensure the full ID is preserved
        const projectOptions = '<option value="">-- Select a project --</option>' +
            response.projects.map(project => {
                // Make sure we're using the full project ID including "b." prefix
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
        // Remove the restriction on same project selection
        // Now both scenarios are valid:
        // 1. Same project = in-place upgrade (create new versions)
        // 2. Different projects = cross-project upgrade (copy and upgrade)
        
        // Update UI to show the mode
        if (sourceId === destId) {
            // Show in-place upgrade indicator
            $('#upgradeMode').remove(); // Remove any existing indicator
            
            const modeIndicator = `
                <div id="upgradeMode" class="alert alert-info" style="margin-top: 10px;">
                    <strong>In-Place Upgrade Mode:</strong> Files will be upgraded within the same project. 
                    New versions will be created for each file while preserving the original folder structure.
                </div>
            `;
            
            $('#destinationProject').closest('.form-group').after(modeIndicator);
            
            // Hide options that don't apply to in-place upgrades
            $('#maintainStructure').prop('checked', true).prop('disabled', true);
            $('#maintainStructure').closest('.checkbox').addClass('text-muted');
            
            // Update button text
            $('#startProjectUpgradeBtn').html(
                '<span class="glyphicon glyphicon-refresh"></span> Upgrade In Place'
            );
            
        } else {
            // Show cross-project upgrade indicator
            $('#upgradeMode').remove();
            
            const modeIndicator = `
                <div id="upgradeMode" class="alert alert-success" style="margin-top: 10px;">
                    <strong>Cross-Project Upgrade Mode:</strong> Files will be copied from source to destination 
                    project and upgraded. Original files remain unchanged.
                </div>
            `;
            
            $('#destinationProject').closest('.form-group').after(modeIndicator);
            
            // Re-enable options for cross-project mode
            $('#maintainStructure').prop('disabled', false);
            $('#maintainStructure').closest('.checkbox').removeClass('text-muted');
            
            // Update button text
            $('#startProjectUpgradeBtn').html(
                '<span class="glyphicon glyphicon-transfer"></span> Copy & Upgrade'
            );
        }
        
        // Enable the start button since selection is valid
        $('#startProjectUpgradeBtn').prop('disabled', false);
        
    } else {
        // No selection made yet
        $('#upgradeMode').remove();
        $('#startProjectUpgradeBtn').prop('disabled', true);
    }
}

/**
 * Analyze source project to show what will be upgraded
 */
async function analyzeSourceProject() {
    const sourceId = $('#sourceProject').val();
    const destId = $('#destinationProject').val();
    
    if (!sourceId) {
        showAlert('Please select a source project first.', 'warning');
        return;
    }
    
    const isInPlaceUpgrade = sourceId === destId;
    
    $('#analyzeProjectBtn').prop('disabled', true).html(
        '<span class="glyphicon glyphicon-refresh spinning"></span> Analyzing...'
    );
    
    try {
        // In a real implementation, you would call an analysis endpoint
        // For now, we'll simulate the analysis
        const mockAnalysis = {
            totalFolders: 12,
            totalFiles: 45,
            filesByType: {
                rvt: 30,
                rfa: 12,
                rte: 3
            },
            estimatedTime: isInPlaceUpgrade ? '10-15 minutes' : '15-20 minutes',
            mode: isInPlaceUpgrade ? 'in-place' : 'cross-project'
        };
        
        const analysisHtml = `
            <div class="well">
                <strong>Upgrade Mode:</strong> ${isInPlaceUpgrade ? 
                    'In-Place (creating new versions)' : 
                    'Cross-Project (copying to destination)'}
                <br><br>
                <strong>Source project contains:</strong>
                <ul>
                    <li>${mockAnalysis.totalFolders} folders</li>
                    <li>${mockAnalysis.totalFiles} Revit files total
                        <ul>
                            <li>${mockAnalysis.filesByType.rvt} RVT files</li>
                            <li>${mockAnalysis.filesByType.rfa} RFA files</li>
                            <li>${mockAnalysis.filesByType.rte} RTE files</li>
                        </ul>
                    </li>
                </ul>
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
                <strong>Estimated time:</strong> ${mockAnalysis.estimatedTime}
            </div>
        `;
        
        $('#analysisContent').html(analysisHtml);
        $('#projectAnalysisResult').show();
        
    } catch (error) {
        console.error('Failed to analyze project:', error);
        showAlert('Failed to analyze project. Please try again.', 'danger');
    } finally {
        $('#analyzeProjectBtn').prop('disabled', false).html(
            '<span class="glyphicon glyphicon-search"></span> Analyze Source'
        );
    }
}

/**
 * Start the project upgrade process
 */
async function startProjectUpgrade() {
    const sourceProjectId = $('#sourceProject').val();
    const destinationProjectId = $('#destinationProject').val();
    const targetVersion = $('input[name="projectTargetVersion"]:checked').val();
    
    if (!sourceProjectId || !destinationProjectId) {
        showAlert('Please select both source and destination projects.', 'warning');
        return;
    }
    
    // Prepare request data
    const requestData = {
        sourceProjectId,
        destinationProjectId,
        targetVersion,
        maintainStructure: $('#maintainStructure').is(':checked'),
        skipExisting: $('#skipExisting').is(':checked'),
        includeWorkshared: $('#includeWorkshared').is(':checked')
    };
    
    try {
        // Start the upgrade
        const response = await $.ajax({
            url: '/api/aps/da4revit/v1/upgrader/project',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(requestData)
        });
        
        if (response.success) {
            // Store batch ID for tracking
            window.currentProjectUpgradeBatchId = response.batchId;
            
            // Close selection modal and open progress modal
            $('#projectUpgradeModal').modal('hide');
            $('#projectUpgradeProgressModal').modal('show');
            
            // Initialize progress tracking
            $('#totalFilesCount').text(response.summary.totalFiles);
            addLogEntry(`Started upgrading ${response.summary.totalFiles} files to Revit ${targetVersion}`);
            addLogEntry(`Batch ID: ${response.batchId}`);
            
            // Start polling for progress
            startProgressPolling(response.batchId);
        }
        
    } catch (error) {
        console.error('Failed to start project upgrade:', error);
        showAlert('Failed to start project upgrade. ' + (error.responseJSON?.error || ''), 'danger');
    }
}

/**
 * Poll for upgrade progress
 */
function startProgressPolling(batchId) {
    // Clear any existing interval
    if (window.projectUpgradeInterval) {
        clearInterval(window.projectUpgradeInterval);
    }
    
    // Poll every 2 seconds
    window.projectUpgradeInterval = setInterval(async () => {
        try {
            const status = await $.ajax({
                url: `/api/aps/da4revit/v1/upgrader/project/${batchId}/status`,
                method: 'GET'
            });
            
            updateProgressDisplay(status);
            
            // Check if complete
            if (status.isComplete || status.percentComplete === 100) {
                clearInterval(window.projectUpgradeInterval);
                onUpgradeComplete(status);
            }
            
        } catch (error) {
            console.error('Failed to get upgrade status:', error);
            // Don't stop polling on error, just log it
        }
    }, 2000);
}

/**
 * Update the progress display
 */
function updateProgressDisplay(status) {
    // Update progress bar
    const percent = status.percentComplete || 0;
    $('#projectUpgradeProgressBar')
        .css('width', percent + '%')
        .text(percent + '%');
    
    // Update counters
    $('#completedFilesCount').text(status.completedFiles || 0);
    $('#processingFilesCount').text(status.processingFiles || 0);
    $('#failedFilesCount').text(status.failedFiles || 0);
    
    // Add mode-specific information
    if (status.projectInfo && $('#upgradeModeSummary').length === 0) {
        const isInPlace = status.projectInfo.sourceProject === status.projectInfo.destinationProject;
        const modeSummary = `
            <div id="upgradeModeSummary" class="well well-sm" style="margin-bottom: 10px;">
                <strong>Mode:</strong> ${isInPlace ? 'In-Place Upgrade' : 'Cross-Project Upgrade'}<br>
                <strong>Target Version:</strong> Revit ${status.targetVersion || '2023'}
            </div>
        `;
        $('#projectUpgradeStats').before(modeSummary);
    }
    
    // Add log entries for completed files with mode context
    if (status.files) {
        status.files.forEach(file => {
            if (file.status === 'completed' && !file.logged) {
                const action = status.upgradeMode === 'in-place' ? 'version created' : 'copied & upgraded';
                addLogEntry(`✓ Completed: ${file.name} (${action})`, 'success');
                file.logged = true;
            } else if (file.status === 'failed' && !file.logged) {
                addLogEntry(`✗ Failed: ${file.name} - ${file.error}`, 'danger');
                file.logged = true;
            }
        });
    }
    
    // Show estimated time remaining
    if (status.estimatedTimeRemaining) {
        addLogEntry(`Estimated time remaining: ${status.estimatedTimeRemaining}`, 'info', true);
    }
}

function initializeProjectUpgradeModal() {
    // Update the modal description to explain both modes
    const updatedDescription = `
        <div class="alert alert-info">
            <strong>How it works:</strong> 
            <ul style="margin-bottom: 0;">
                <li><strong>Same Project (In-Place):</strong> Creates new versions of all Revit files within the current project</li>
                <li><strong>Different Projects:</strong> Copies files to destination project and upgrades them</li>
            </ul>
        </div>
    `;
    
    // Replace the existing alert in the modal
    $('#projectUpgradeModal .alert-info').replaceWith(updatedDescription);
    
    // Update the destination project helper text
    $('#destinationProject').siblings('small').text(
        'Select same project for in-place upgrade or different project to copy'
    );
}

/**
 * Handle upgrade completion
 */
function onUpgradeComplete(status) {
    $('#projectUpgradeProgressBar').removeClass('active');
    $('#cancelProjectUpgradeBtn').hide();
    $('#closeProgressBtn').show();
    
    const message = `Upgrade complete! Successfully processed ${status.completedFiles} files.`;
    if (status.failedFiles > 0) {
        message += ` ${status.failedFiles} files failed.`;
    }
    
    addLogEntry(message, status.failedFiles > 0 ? 'warning' : 'success');
    
    // Show notification
    showAlert(message, status.failedFiles > 0 ? 'warning' : 'success');
}

/**
 * Cancel the upgrade process
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
 * Add entry to the progress log
 */
function addLogEntry(message, type = 'info', replace = false) {
    const timestamp = new Date().toLocaleTimeString();
    const typeClass = {
        'info': 'text-info',
        'success': 'text-success',
        'warning': 'text-warning',
        'danger': 'text-danger'
    }[type] || '';
    
    const entry = `<div class="${typeClass}">[${timestamp}] ${message}</div>`;
    
    if (replace && $('#logContent').children().last().hasClass(typeClass)) {
        $('#logContent').children().last().replaceWith(entry);
    } else {
        $('#logContent').append(entry);
    }
    
    // Auto-scroll to bottom
    $('#projectUpgradeLog').scrollTop($('#projectUpgradeLog')[0].scrollHeight);
}

/**
 * Show alert message
 */
function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade in" role="alert">
            <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                <span aria-hidden="true">&times;</span>
            </button>
            ${message}
        </div>
    `;
    
    // Add to top of modal body or page
    if ($('.modal.in').length > 0) {
        $('.modal.in .modal-body').prepend(alertHtml);
    } else {
        $('body').prepend(alertHtml);
    }
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        $('.alert').fadeOut(() => $('.alert').remove());
    }, 5000);
}

// Initialize when document is ready
$(document).ready(function() {
    // Add project upgrade functionality after other initializations
    setTimeout(initializeProjectUpgrade, 1000);
});

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
    
    // Extract IDs from the source node
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
      folderId: sourceFolderId,
      targetVersion: targetVersion,
      supportedTypes: supportedTypes
    });

    // Clear the log and show initial status
    const logList = document.getElementById('logStatus');
    logList.innerHTML = '';
    
    addGroupListItem(
      'Bulk Processing', 
      'Analyzing folder contents...', 
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
        folderId: sourceFolderId,
        targetVersion: targetVersion,
        supportedTypes: supportedTypes
      })
    });

    if (response.success) {
      currentBatchId = response.batchId;
      
      // Clear initial status
      logList.innerHTML = '';
      
      // Show summary including workshared files
      addGroupListItem(
        'Bulk Processing Started', 
        `Processing ${response.totalFiles} files`, 
        ItemType.FOLDER, 
        'list-group-item-success'
      );
      
      // Show workshared file warning if any were excluded
      if (response.excludedWorksharedCount > 0) {
        addGroupListItem(
          'Workshared Files Excluded', 
          `${response.excludedWorksharedCount} workshared files cannot be upgraded`, 
          ItemType.FOLDER, 
          'list-group-item-warning'
        );
        
        // List the first few excluded files
        response.excludedFiles.slice(0, 3).forEach(fileName => {
          addGroupListItem(
            `🔒 ${fileName}`, 
            'WORKSHARED - EXCLUDED', 
            ItemType.FILE, 
            'list-group-item-warning'
          );
        });
        
        if (response.excludedFiles.length > 3) {
          addGroupListItem(
            `... and ${response.excludedFiles.length - 3} more workshared files`, 
            'EXCLUDED', 
            ItemType.FOLDER, 
            'list-group-item-warning'
          );
        }
      }
      
      // Show file list for processing
      if (response.files && response.files.length > 0) {
        response.files.forEach((fileName, index) => {
          if (index < 10) { // Show first 10 files
            addGroupListItem(fileName, 'QUEUED', ItemType.FILE, 'list-group-item-info');
          }
        });
        
        if (response.files.length > 10) {
          addGroupListItem(
            `... and ${response.files.length - 10} more files`, 
            'QUEUED', 
            ItemType.FOLDER, 
            'list-group-item-info'
          );
        }
      }
      
      document.getElementById('upgradeTitle').innerHTML = 
        `<h4>🚀 Bulk Processing: ${response.totalFiles} files queued` +
        (response.excludedWorksharedCount > 0 ? 
         ` (${response.excludedWorksharedCount} workshared excluded)` : '') +
        `</h4>`;
      
    } else {
      throw new Error(response.error || 'Failed to start bulk processing');
    }

  } catch (error) {
    console.error('Bulk processing error:', error);
    
    let errorMessage = 'Unknown error';
    let excludedInfo = '';
    
    if (error.responseJSON) {
      errorMessage = error.responseJSON.error || errorMessage;
      
      // Check if all files were workshared
      if (error.responseJSON.excludedWorksharedCount > 0) {
        excludedInfo = ` (${error.responseJSON.excludedWorksharedCount} workshared files were found but cannot be processed)`;
        
        // Show the excluded files if available
        if (error.responseJSON.excludedWorksharedFiles) {
          logList.innerHTML = '';
          addGroupListItem(
            'No Upgradeable Files', 
            'All Revit files in this folder are workshared', 
            ItemType.FOLDER, 
            'list-group-item-danger'
          );
          
          error.responseJSON.excludedWorksharedFiles.slice(0, 5).forEach(fileName => {
            addGroupListItem(
              `🔒 ${fileName}`, 
              'WORKSHARED - CANNOT UPGRADE', 
              ItemType.FILE, 
              'list-group-item-warning'
            );
          });
        }
      }
    }
    
    addGroupListItem('Bulk Processing', 'Failed: ' + errorMessage + excludedInfo, ItemType.FOLDER, 'list-group-item-danger');
    
    let upgradeBtnElm = document.getElementById('upgradeBtn');
    upgradeBtnElm.disabled = false;
    bulkProcessingActive = false;
    document.getElementById('upgradeTitle').innerHTML = `<h4>❌ Bulk Processing Failed: ${errorMessage}</h4>`;
  }
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