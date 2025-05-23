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

const { AuthClientThreeLeggedV2, AuthClientTwoLeggedV2 } = require('forge-apis');

const config = require('../../config');

class OAuth {
    constructor(session) {
        this._session = session || {};
    }

    getClient(scopes = config.scopes.internal) {
        const { client_id, client_secret, callback_url } = config.credentials;
        return new AuthClientThreeLeggedV2(client_id, client_secret, callback_url, scopes);
    }

    get2LeggedClient(scopes = config.scopes.internal_2legged){
        const { client_id, client_secret } = config.credentials;
        return new AuthClientTwoLeggedV2(client_id, client_secret, scopes );
    }

    isAuthorized() {
        return !!this._session.public_token;
    }

    async getPublicToken() {
        if (this._isExpired() && !await this._refreshTokens()) {
            return null;
        }

        return {
            access_token: this._session.public_token,
            expires_in: this._expiresIn()
        };
    }

    async getInternalToken() {
        if (this._isExpired() || this._expiresIn() < 600) { 
            console.log("Token expiring soon or expired, refreshing...");
            
            if (!this._session.refresh_token) {
                console.log("No refresh token present, cannot refresh");
                return null;
            }
            
            if (!await this._refreshTokens()) {
                console.log("Token refresh failed");
                return null;
            }
            console.log("Token refreshed successfully");
        }

        return {
            access_token: this._session.internal_token,
            expires_in: this._expiresIn()
        };
    }

    // On callback, pass the CODE to this function, it will
    // get the internal and public tokens and store them 
    // on the session
    async setCode(code) {
    try {
        console.log('Setting code:', code);
        console.log('Using callback URL:', config.credentials.callback_url);
        
        const internalTokenClient = this.getClient(config.scopes.internal);
        const publicTokenClient = this.getClient(config.scopes.public);
        
        console.log('Getting token from code...');
        const internalCredentials = await internalTokenClient.getToken(code);
        console.log('Got internal token, getting public token...');
        const publicCredentials = await publicTokenClient.refreshToken(internalCredentials);

        const now = new Date();
        this._session.internal_token = internalCredentials.access_token;
        this._session.public_token = publicCredentials.access_token;
        this._session.refresh_token = publicCredentials.refresh_token;
        this._session.expires_at = (now.setSeconds(now.getSeconds() + publicCredentials.expires_in));
        
        console.log('Successfully set tokens in session');
        return true;
    }
    catch (err) {
        console.log('Failed to get token due to:', err);
        console.log('Error details:', err.response ? err.response.data : 'No response data');
        return false;
    }
}

    _expiresIn() {
        const now = new Date();
        const expiresAt = new Date(this._session.expires_at)
        return Math.round((expiresAt.getTime() - now.getTime()) / 1000);
    };

    _isExpired() {
        return (new Date() > new Date(this._session.expires_at));
    }

    async _refreshTokens() {
        try {
            let internalTokenClient = this.getClient(config.scopes.internal);
            let publicTokenClient = this.getClient(config.scopes.public);
            const internalCredentials = await internalTokenClient.refreshToken({ refresh_token: this._session.refresh_token });
            const publicCredentials = await publicTokenClient.refreshToken(internalCredentials);

            const now = new Date();
            this._session.internal_token = internalCredentials.access_token;
            this._session.public_token = publicCredentials.access_token;
            this._session.refresh_token = publicCredentials.refresh_token;
            this._session.expires_at = (now.setSeconds(now.getSeconds() + publicCredentials.expires_in));
            return true;
        }
        catch (err) {
            console.log("failed to refresh token due to " + err);
            return false;
        }
    }
}

module.exports = { OAuth };
