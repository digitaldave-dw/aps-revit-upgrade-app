// Enhanced Version Detection Module for Revit Files
// This provides more comprehensive and performant version detection

const fetch = require('node-fetch');
const { ItemsApi, VersionsApi } = require('forge-apis');

class EnhancedRevitVersionDetector {
    constructor() {
        // Expanded caches for better performance
        this.versionCache = new Map();
        this.manifestCache = new Map();
        this.worksharedCache = new Map();
        this.filePropertiesCache = new Map();
        
        // Enhanced statistics tracking
        this.stats = {
            cacheHits: 0,
            derivativeChecks: 0,
            filenameChecks: 0,
            propertyChecks: 0,
            totalChecks: 0,
            worksharedDetected: 0,
            errors: []
        };
        
        // Configuration
        this.config = {
            cacheTimeout: 3600000, // 1 hour in milliseconds
            maxRetries: 2,
            retryDelay: 1000
        };
        
        // Version mapping (internal version numbers to year)
        this.versionMap = {
            '2019': 2019,
            '2020': 2020,
            '2021': 2021,
            '2022': 2022,
            '2023': 2023,
            '2024': 2024,
            '19': 2019,
            '20': 2020,
            '21': 2021,
            '22': 2022,
            '23': 2023,
            '24': 2024
        };
    }

    /**
     * Enhanced main method to check if a file needs upgrading
     * Now includes workshared detection and better error handling
     * @param {boolean} allowWorkshared - If true, don't skip workshared files (for Revit 2025 detach mode)
     */
    async needsUpgrade(projectId, itemId, itemName, targetVersion, oauth_client, oauth_token, allowWorkshared = false) {
        this.stats.totalChecks++;
        const targetVersionNum = parseInt(targetVersion);

        // Create composite cache key
        const cacheKey = `${projectId}:${itemId}`;
        const cachedData = this.getCachedVersion(cacheKey);

        if (cachedData) {
            this.stats.cacheHits++;
            console.log(`📦 Cache hit: ${itemName} is Revit ${cachedData.version}${cachedData.isWorkshared ? ' (WORKSHARED)' : ''}`);

            // Return false if workshared (unless allowWorkshared is true) OR already at target version
            if (cachedData.isWorkshared && !allowWorkshared) {
                this.stats.worksharedDetected++;
                return false;
            }
            // For workshared files with allowWorkshared, assume they need upgrade (we can't easily detect version)
            if (cachedData.isWorkshared && allowWorkshared) {
                this.stats.worksharedDetected++;
                return true;
            }
            return cachedData.version < targetVersionNum;
        }

        try {
            // First, check if this is a workshared file
            const isWorkshared = await this.isWorksharedFile(projectId, itemId, oauth_client, oauth_token);
            if (isWorkshared) {
                this.stats.worksharedDetected++;
                this.setCachedVersion(cacheKey, null, true);
                if (allowWorkshared) {
                    console.log(`🔓 Workshared file detected: ${itemName} - will be detached for upgrade`);
                    return true;  // Process it with detach
                }
                console.log(`🔒 Workshared file detected: ${itemName} - skipping upgrade`);
                return false;
            }
            
            // Get comprehensive version information
            const versionInfo = await this.getComprehensiveVersionInfo(
                projectId, 
                itemId, 
                itemName, 
                oauth_client, 
                oauth_token
            );
            
            if (versionInfo.version) {
                console.log(`✅ Detected version: ${itemName} is Revit ${versionInfo.version} (method: ${versionInfo.method})`);
                this.setCachedVersion(cacheKey, versionInfo.version, false);
                return versionInfo.version < targetVersionNum;
            }
            
            // If we can't determine version, check if we should assume it needs upgrade
            if (this.shouldAssumeNeedsUpgrade(itemName, targetVersion)) {
                console.log(`❓ Cannot determine version for ${itemName} - assuming upgrade needed`);
                return true;
            }
            
            return false;
            
        } catch (error) {
            this.stats.errors.push({ file: itemName, error: error.message });
            console.error(`❌ Error checking ${itemName}:`, error.message);
            
            // On error, be conservative based on file characteristics
            return this.shouldAssumeNeedsUpgrade(itemName, targetVersion);
        }
    }
    
    /**
     * Comprehensive version detection using multiple methods
     */
    async getComprehensiveVersionInfo(projectId, itemId, itemName, oauth_client, oauth_token) {
        // Method 1: Check item properties first (fastest if available)
        const propertyVersion = await this.getVersionFromProperties(projectId, itemId, oauth_client, oauth_token);
        if (propertyVersion) {
            this.stats.propertyChecks++;
            return { version: propertyVersion, method: 'properties' };
        }
        
        // Method 2: Check derivatives if available
        const derivativeVersion = await this.getVersionFromDerivatives(projectId, itemId, oauth_client, oauth_token);
        if (derivativeVersion) {
            this.stats.derivativeChecks++;
            return { version: derivativeVersion, method: 'derivatives' };
        }
        
        // Method 3: Check filename patterns
        const filenameVersion = this.detectVersionFromFilename(itemName);
        if (filenameVersion) {
            this.stats.filenameChecks++;
            return { version: filenameVersion, method: 'filename' };
        }
        
        // Method 4: Check version history for clues
        const historyVersion = await this.getVersionFromHistory(projectId, itemId, oauth_client, oauth_token);
        if (historyVersion) {
            return { version: historyVersion, method: 'history' };
        }
        
        return { version: null, method: null };
    }
    
    /**
     * Enhanced workshared file detection
     */
    async isWorksharedFile(projectId, itemId, oauth_client, oauth_token) {
        const cacheKey = `workshared:${projectId}:${itemId}`;
        
        if (this.worksharedCache.has(cacheKey)) {
            return this.worksharedCache.get(cacheKey);
        }
        
        try {
            const items = new ItemsApi();
            const versions = new VersionsApi();
            
            // Get the latest version
            const versionsResponse = await items.getItemVersions(
                projectId, 
                itemId, 
                {}, 
                oauth_client, 
                oauth_token
            );
            
            if (!versionsResponse || versionsResponse.statusCode !== 200) {
                return false;
            }
            
            const latestVersion = versionsResponse.body.data[0];
            if (!latestVersion) return false;
            
            // Check multiple indicators of workshared files
            const extensionType = latestVersion.attributes?.extension?.type;
            const isWorkshared = 
                extensionType === 'versions:autodesk.bim360:C4RModel' ||
                extensionType?.includes('C4R') ||
                latestVersion.attributes?.extension?.data?.isCompositeDesign === true ||
                latestVersion.attributes?.extension?.data?.modelType === 'collaboration' ||
                latestVersion.attributes?.extension?.data?.worksharingEnabled === true;
            
            this.worksharedCache.set(cacheKey, isWorkshared);
            return isWorkshared;
            
        } catch (error) {
            console.error('Error checking workshared status:', error);
            return false;
        }
    }
    
    /**
     * Get version from item properties (new method)
     */
    async getVersionFromProperties(projectId, itemId, oauth_client, oauth_token) {
        try {
            const items = new ItemsApi();
            const itemResponse = await items.getItem(projectId, itemId, oauth_client, oauth_token);
            
            if (itemResponse?.body?.data?.attributes?.extension?.data?.revitVersion) {
                return parseInt(itemResponse.body.data.attributes.extension.data.revitVersion);
            }
            
            // Check in version attributes
            const versionsResponse = await items.getItemVersions(projectId, itemId, {}, oauth_client, oauth_token);
            if (versionsResponse?.body?.data?.[0]?.attributes?.extension?.data?.revitVersion) {
                return parseInt(versionsResponse.body.data[0].attributes.extension.data.revitVersion);
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Enhanced derivative checking with retry logic
     */
    async getVersionFromDerivatives(projectId, itemId, oauth_client, oauth_token) {
        try {
            const items = new ItemsApi();
            const versionsResponse = await items.getItemVersions(
                projectId, 
                itemId, 
                {}, 
                oauth_client, 
                oauth_token
            );
            
            if (!versionsResponse || versionsResponse.statusCode !== 200) {
                return null;
            }
            
            const latestVersion = versionsResponse.body.data[0];
            if (!latestVersion?.relationships?.derivatives?.meta?.link?.href) {
                return null;
            }
            
            const manifestUrl = latestVersion.relationships.derivatives.meta.link.href;
            return await this.getRevitVersionFromManifest(manifestUrl, oauth_token.access_token);
            
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Enhanced manifest parsing with more locations to check
     */
    async getRevitVersionFromManifest(manifestUrl, accessToken) {
        if (this.manifestCache.has(manifestUrl)) {
            return this.manifestCache.get(manifestUrl);
        }
        
        let retries = this.config.maxRetries;
        
        while (retries >= 0) {
            try {
                const response = await fetch(manifestUrl, {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    if (retries > 0 && response.status === 429) {
                        // Rate limited, wait and retry
                        await this.sleep(this.config.retryDelay * (this.config.maxRetries - retries + 1));
                        retries--;
                        continue;
                    }
                    return null;
                }
                
                const manifest = await response.json();
                
                // Check multiple possible locations for version info
                const versionLocations = [
                    () => manifest.derivatives?.[0]?.properties?.['Document Information']?.RVTVersion,
                    () => manifest.derivatives?.[0]?.properties?.['Document Information']?.['Revit Version'],
                    () => manifest.derivatives?.[0]?.metadata?.RVTVersion,
                    () => manifest.derivatives?.[0]?.metadata?.revitVersion,
                    () => manifest.derivatives?.[0]?.properties?.metadata?.revit?.version,
                    () => {
                        // Check in children elements
                        if (manifest.derivatives?.[0]?.children) {
                            for (const child of manifest.derivatives[0].children) {
                                if (child.role === 'Autodesk.CloudPlatform.PropertyDatabase') {
                                    if (child.properties?.RVTVersion) return child.properties.RVTVersion;
                                    if (child.metadata?.RVTVersion) return child.metadata.RVTVersion;
                                }
                            }
                        }
                        return null;
                    }
                ];
                
                for (const getVersion of versionLocations) {
                    const version = getVersion();
                    if (version) {
                        const parsedVersion = this.parseRevitVersion(version);
                        if (parsedVersion) {
                            this.manifestCache.set(manifestUrl, parsedVersion);
                            return parsedVersion;
                        }
                    }
                }
                
                return null;
                
            } catch (error) {
                if (retries > 0) {
                    await this.sleep(this.config.retryDelay);
                    retries--;
                } else {
                    return null;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Enhanced filename pattern detection
     */
    detectVersionFromFilename(filename) {
        // Expanded patterns to catch more variations
        const patterns = [
            /[_\-\s](2019|2020|2021|2022|2023|2024)\.rvt$/i,  // file_2023.rvt
            /[_\-\s]v(2019|2020|2021|2022|2023|2024)\.rvt$/i, // file_v2023.rvt
            /\((2019|2020|2021|2022|2023|2024)\)\.rvt$/i,     // file(2023).rvt
            /[_\-\s]r(19|20|21|22|23|24)\.rvt$/i,             // file_r23.rvt
            /[_\-\s]RVT(2019|2020|2021|2022|2023|2024)/i,     // file_RVT2023
            /[\[\(](2019|2020|2021|2022|2023|2024)[\]\)]/i,   // file[2023] or file(2023)
            /_v?(19|20|21|22|23|24)_/i,                       // file_v23_final.rvt
        ];
        
        for (const pattern of patterns) {
            const match = filename.match(pattern);
            if (match) {
                const versionStr = match[1];
                if (this.versionMap[versionStr]) {
                    return this.versionMap[versionStr];
                }
                return parseInt(versionStr);
            }
        }
        
        return null;
    }
    
    /**
     * Check version history for upgrade indicators
     */
    async getVersionFromHistory(projectId, itemId, oauth_client, oauth_token) {
        try {
            const items = new ItemsApi();
            const versions = await items.getItemVersions(projectId, itemId, {}, oauth_client, oauth_token);
            
            if (!versions || versions.statusCode !== 200) return null;
            
            // Look through version history for upgrade indicators
            for (const version of versions.body.data) {
                const versionName = version.attributes.name;
                const versionFromName = this.detectVersionFromFilename(versionName);
                if (versionFromName) return versionFromName;
                
                // Check version comments for upgrade notes
                const comment = version.attributes.extension?.data?.comment;
                if (comment) {
                    const upgradeMatch = comment.match(/upgraded?\s+to\s+(?:revit\s+)?(20\d{2})/i);
                    if (upgradeMatch) {
                        return parseInt(upgradeMatch[1]);
                    }
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Parse various Revit version formats
     */
    parseRevitVersion(versionString) {
        if (typeof versionString === 'number') return versionString;
        
        const versionStr = versionString.toString();
        
        // Direct year format
        if (/^20\d{2}$/.test(versionStr)) {
            return parseInt(versionStr);
        }
        
        // Internal version format (e.g., "21.0.0")
        const internalMatch = versionStr.match(/^(\d+)\./);
        if (internalMatch) {
            const internal = parseInt(internalMatch[1]);
            if (internal >= 19 && internal <= 24) {
                return 2000 + internal;
            }
        }
        
        // Check version map
        if (this.versionMap[versionStr]) {
            return this.versionMap[versionStr];
        }
        
        return null;
    }
    
    /**
     * Determine if we should assume a file needs upgrade
     */
    shouldAssumeNeedsUpgrade(filename, targetVersion) {
        // If filename contains version info that's older than target, assume yes
        const filenameVersion = this.detectVersionFromFilename(filename);
        if (filenameVersion && filenameVersion < parseInt(targetVersion)) {
            return true;
        }
        
        // If filename suggests it's an old file, assume yes
        const oldFilePatterns = [
            /archive/i,
            /old/i,
            /legacy/i,
            /201[0-8]/,  // Pre-2019 versions
        ];
        
        return oldFilePatterns.some(pattern => pattern.test(filename));
    }
    
    /**
     * Cache management with TTL
     */
    getCachedVersion(cacheKey) {
        const cached = this.versionCache.get(cacheKey);
        if (!cached) return null;
        
        // Check if cache is still valid
        if (Date.now() - cached.timestamp > this.config.cacheTimeout) {
            this.versionCache.delete(cacheKey);
            return null;
        }
        
        return cached;
    }
    
    setCachedVersion(cacheKey, version, isWorkshared) {
        this.versionCache.set(cacheKey, {
            version,
            isWorkshared,
            timestamp: Date.now()
        });
    }
    
    /**
     * Get comprehensive statistics
     */
    getStats() {
        const totalHits = this.stats.cacheHits + this.stats.derivativeChecks + 
                         this.stats.filenameChecks + this.stats.propertyChecks;
        
        return {
            ...this.stats,
            cacheEfficiency: this.stats.totalChecks > 0 ? 
                ((this.stats.cacheHits / this.stats.totalChecks) * 100).toFixed(1) + '%' : '0%',
            detectionSuccess: totalHits > 0 ? 
                ((totalHits / this.stats.totalChecks) * 100).toFixed(1) + '%' : '0%',
            worksharedRate: this.stats.totalChecks > 0 ?
                ((this.stats.worksharedDetected / this.stats.totalChecks) * 100).toFixed(1) + '%' : '0%',
            averageCheckTime: this.stats.totalChecks > 0 ?
                (this.getAverageCheckTime()).toFixed(2) + 'ms' : '0ms'
        };
    }
    
    getAverageCheckTime() {
        // This would track actual timing in production
        return 250; // Placeholder
    }
    
    /**
     * Clear all caches
     */
    clearCache() {
        this.versionCache.clear();
        this.manifestCache.clear();
        this.worksharedCache.clear();
        this.filePropertiesCache.clear();
        console.log('All version detection caches cleared');
    }
    
    /**
     * Utility sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export enhanced singleton instance
module.exports = new EnhancedRevitVersionDetector();