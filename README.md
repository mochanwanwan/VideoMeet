# VideoMeet - Global Video Conferencing App

A production-ready video conferencing application built with React, Node.js, Express, and Socket.IO.

## Features

- 🎥 HD Video & Audio calling
- 🖥️ Screen sharing
- 👥 Multi-participant support
- 🔗 Easy room sharing with URLs
- 📱 Responsive design
- 🌐 Global access
- 🔒 Secure peer-to-peer connections

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, Socket.IO
- **WebRTC**: Peer-to-peer video/audio communication
- **Icons**: Lucide React

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. In another terminal, start the backend server:
```bash
npm run server
```

4. Open http://localhost:5173 in your browser

## Production Deployment

This app is configured for deployment on Render.com:

1. Connect your GitHub repository to Render
2. Create a new Web Service
3. Use the following settings:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Environment**: Node.js
   - **Plan**: Free

The app will automatically build and deploy. The `render.yaml` file contains the deployment configuration.

## How to Use

1. Enter your name
2. Either create a new room or join an existing one with a room ID
3. Share the room URL or room ID with others
4. Enjoy your video call!

## Environment Variables

- `NODE_ENV`: Set to 'production' for production deployment
- `PORT`: Server port (automatically set by Render)

## Architecture

- **Single Server**: Both frontend and backend are served from the same Express server
- **WebRTC**: Direct peer-to-peer connections for video/audio
- **Socket.IO**: Signaling server for WebRTC handshake
- **STUN Servers**: Google's public STUN servers for NAT traversal

## Browser Support

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

Requires HTTPS for camera/microphone access in production.