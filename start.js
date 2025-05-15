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

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
require('dotenv').config();

const PORT = process.env.PORT || 8080; 
const config = require('./config');
if (config.credentials.client_id == null || config.credentials.client_secret == null) {
    console.error('Missing APS_CLIENT_ID or APS_CLIENT_SECRET env. variables.');
    return;
}

if (!String.prototype.format) {
    String.prototype.format = function () {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
                ;
        });
    };
}

console.log(`Webhook URL configured as: ${config.designAutomation.webhook_url}`);

// Create Express app
var app = express();

// Apply session middleware first
app.use(cookieSession({
    name: 'aps_session',
    keys: ['aps_secure_key'],
    maxAge: 14 * 24 * 60 * 60 * 1000,
    secure: false, // Set to false for localhost
    httpOnly: true
}));

app.use(express.json({ limit: '50mb' }));

// Import the OAuth implementation
const { OAuth } = require('./routes/common/oauthImp');

// Handle root path for OAuth callbacks
app.get('/', async (req, res, next) => {
    // Check if this is an OAuth callback
    if (req.query.code) {
        console.log('Received OAuth callback with code at root path');
        
        try {
            // Create a new OAuth handler with the current session
            const oauth = new OAuth(req.session);
            
            // Process the authorization code
            const success = await oauth.setCode(req.query.code);
            
            if (success) {
                console.log('Successfully authenticated and stored tokens');
                
                // Instead of redirecting, render the index page directly
                // This avoids the double-redirect problem
                return res.sendFile(path.join(__dirname, 'public', 'index.html'));
            } else {
                console.error('Failed to get token from code');
                return res.status(500).send('Failed to authenticate with Autodesk');
            }
        } catch(err) {
            console.error('Error processing OAuth callback:', err);
            return next(err);
        }
    } else if (req.query.error) {
        console.error('OAuth error received:', req.query.error);
        return res.status(400).send(`Authentication error: ${req.query.error}`);
    }
    
    // Not an OAuth callback, continue to static files
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Set up API routes
app.use('/api/aps', require('./routes/oauth'));
app.use('/api/aps', require('./routes/datamanagement'));
app.use('/api/aps', require('./routes/user'));
app.use('/api/aps', require('./routes/da4revit'));
app.use('/api/aps', require('./routes/daconfigure'));

// Error handling
app.use((err, req, res, next) => {
    console.error('Application error:', err);
    res.status(err.statusCode || 500).json(err);
});

// Set up socket connection
var server = require('http').Server(app); 
global.MyApp = {
    SocketIo : require('socket.io')(server)
};
global.MyApp.SocketIo.on('connection', function(socket){
    console.log('user connected to the socket');
    socket.on('disconnect', function(){
        console.log('user disconnected from the socket');
    });
});

// Start server
server.listen(PORT, () => { 
    console.log(`Server listening on port ${PORT}`); 
    console.log(`OAuth callback URL configured as: ${config.credentials.callback_url}`);
    console.log(`Make sure this exactly matches what's registered in the APS Developer Portal`);
});