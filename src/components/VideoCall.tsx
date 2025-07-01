import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  Monitor, 
  PhoneOff, 
  Users,
  Settings,
  MessageSquare,
  Copy,
  Share2,
  Check
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface Participant {
  userId: string;
  userName: string;
  stream?: MediaStream;
  isVideoOn?: boolean;
  isAudioOn?: boolean;
}

interface VideoCallProps {
  roomId: string;
  userName: string;
  onLeaveCall: () => void;
}

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' }
];

export const VideoCall: React.FC<VideoCallProps> = ({ roomId, userName, onLeaveCall }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(new Map());
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'failed'>('connecting');
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const userId = useRef(Math.random().toString(36).substr(2, 9));
  const socketRef = useRef<Socket | null>(null);

  // Initialize WebRTC and Socket connection
  useEffect(() => {
    const initializeCall = async () => {
      try {
        console.log('Initializing call for user:', userId.current, 'in room:', roomId);
        
        // Get user media first
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: { 
            echoCancellation: true, 
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        console.log('Got local stream:', stream.getTracks().map(t => t.kind));
        setLocalStream(stream);
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Initialize socket connection - use same origin for production
        const socketUrl = window.location.origin;
        
        console.log('Connecting to socket server:', socketUrl);
        const newSocket = io(socketUrl, {
          transports: ['websocket', 'polling'],
          timeout: 20000,
          forceNew: true
        });
        
        socketRef.current = newSocket;
        setSocket(newSocket);

        // Socket event handlers
        newSocket.on('connect', () => {
          console.log('Socket connected with ID:', newSocket.id);
          setConnectionStatus('connected');
          
          // Join room after socket connection is established
          console.log('Joining room:', roomId, 'as user:', userId.current, userName);
          newSocket.emit('join-room', {
            roomId,
            userId: userId.current,
            userName
          });
        });

        newSocket.on('connect_error', (error) => {
          console.error('Socket connection error:', error);
          setConnectionStatus('failed');
        });

        newSocket.on('disconnect', (reason) => {
          console.log('Socket disconnected:', reason);
          setConnectionStatus('connecting');
        });

        // WebRTC signaling handlers
        newSocket.on('user-joined', async ({ userId: newUserId, userName: newUserName }) => {
          console.log('=== USER JOINED EVENT ===');
          console.log('New user joined:', newUserId, newUserName);
          
          // Add participant to state
          setParticipants(prev => {
            const updated = new Map(prev);
            if (!updated.has(newUserId)) {
              console.log('Adding new participant:', newUserId);
              updated.set(newUserId, { 
                userId: newUserId, 
                userName: newUserName, 
                isVideoOn: true, 
                isAudioOn: true 
              });
            }
            return updated;
          });

          // Create peer connection and send offer
          await createOfferForUser(newUserId, stream, newSocket);
        });

        newSocket.on('room-participants', (participantsList: Participant[]) => {
          console.log('=== ROOM PARTICIPANTS EVENT ===');
          console.log('Existing participants:', participantsList);
          
          setParticipants(prev => {
            const updated = new Map(prev);
            participantsList.forEach(participant => {
              if (participant.userId !== userId.current) {
                console.log('Adding existing participant:', participant.userId, participant.userName);
                updated.set(participant.userId, { 
                  ...participant, 
                  isVideoOn: true, 
                  isAudioOn: true 
                });
              }
            });
            return updated;
          });
        });

        newSocket.on('offer', async ({ offer, callerUserId }) => {
          console.log('=== RECEIVED OFFER ===');
          console.log('Offer from:', callerUserId);
          await handleIncomingOffer(offer, callerUserId, stream, newSocket);
        });

        newSocket.on('answer', async ({ answer, answererUserId }) => {
          console.log('=== RECEIVED ANSWER ===');
          console.log('Answer from:', answererUserId);
          await handleIncomingAnswer(answer, answererUserId);
        });

        newSocket.on('ice-candidate', async ({ candidate, senderUserId }) => {
          console.log('=== RECEIVED ICE CANDIDATE ===');
          console.log('ICE candidate from:', senderUserId);
          await handleIncomingIceCandidate(candidate, senderUserId);
        });

        newSocket.on('user-left', ({ userId: leftUserId, userName: leftUserName }) => {
          console.log('=== USER LEFT ===');
          console.log('User left:', leftUserId, leftUserName);
          
          setParticipants(prev => {
            const updated = new Map(prev);
            updated.delete(leftUserId);
            return updated;
          });
          
          // Close and remove peer connection
          const peerConnection = peerConnections.current.get(leftUserId);
          if (peerConnection) {
            peerConnection.close();
            peerConnections.current.delete(leftUserId);
            console.log('Closed peer connection for:', leftUserId);
          }
        });

        newSocket.on('user-video-toggled', ({ userId: toggledUserId, isVideoOn: videoOn }) => {
          console.log('User video toggled:', toggledUserId, videoOn);
          setParticipants(prev => {
            const updated = new Map(prev);
            const participant = updated.get(toggledUserId);
            if (participant) {
              updated.set(toggledUserId, { ...participant, isVideoOn: videoOn });
            }
            return updated;
          });
        });

        newSocket.on('user-audio-toggled', ({ userId: toggledUserId, isAudioOn: audioOn }) => {
          console.log('User audio toggled:', toggledUserId, audioOn);
          setParticipants(prev => {
            const updated = new Map(prev);
            const participant = updated.get(toggledUserId);
            if (participant) {
              updated.set(toggledUserId, { ...participant, isAudioOn: audioOn });
            }
            return updated;
          });
        });

      } catch (error) {
        console.error('Error initializing call:', error);
        setConnectionStatus('failed');
      }
    };

    initializeCall();

    return () => {
      console.log('=== CLEANUP ===');
      // Stop all tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
          console.log('Stopped track:', track.kind);
        });
      }
      
      // Close all peer connections
      peerConnections.current.forEach((pc, userId) => {
        pc.close();
        console.log('Closed peer connection for:', userId);
      });
      peerConnections.current.clear();
      
      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [roomId, userName]);

  const createPeerConnection = (targetUserId: string, stream: MediaStream) => {
    console.log('Creating peer connection for:', targetUserId);
    
    const peerConnection = new RTCPeerConnection({
      iceServers: STUN_SERVERS
    });

    // Add local stream tracks
    stream.getTracks().forEach(track => {
      console.log('Adding track to peer connection:', track.kind, 'for user:', targetUserId);
      peerConnection.addTrack(track, stream);
    });

    // Handle incoming stream
    peerConnection.ontrack = (event) => {
      console.log('=== RECEIVED REMOTE TRACK ===');
      console.log('Track from:', targetUserId, 'kind:', event.track.kind);
      const [remoteStream] = event.streams;
      
      setParticipants(prev => {
        const updated = new Map(prev);
        const participant = updated.get(targetUserId);
        if (participant) {
          console.log('Setting stream for participant:', targetUserId);
          updated.set(targetUserId, { ...participant, stream: remoteStream });
        }
        return updated;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        console.log('Sending ICE candidate to:', targetUserId);
        socketRef.current.emit('ice-candidate', {
          targetUserId,
          candidate: event.candidate,
          roomId
        });
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(`Peer connection state with ${targetUserId}:`, peerConnection.connectionState);
      if (peerConnection.connectionState === 'failed') {
        console.log('Peer connection failed, attempting to restart ICE');
        peerConnection.restartIce();
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${targetUserId}:`, peerConnection.iceConnectionState);
    };

    peerConnections.current.set(targetUserId, peerConnection);
    return peerConnection;
  };

  const createOfferForUser = async (targetUserId: string, stream: MediaStream, socket: Socket) => {
    try {
      console.log('Creating offer for user:', targetUserId);
      const peerConnection = createPeerConnection(targetUserId, stream);
      
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await peerConnection.setLocalDescription(offer);
      console.log('Local description set, sending offer to:', targetUserId);
      
      socket.emit('offer', {
        targetUserId,
        offer,
        roomId
      });
    } catch (error) {
      console.error('Error creating offer for', targetUserId, ':', error);
    }
  };

  const handleIncomingOffer = async (offer: RTCSessionDescriptionInit, callerUserId: string, stream: MediaStream, socket: Socket) => {
    try {
      console.log('Handling incoming offer from:', callerUserId);
      const peerConnection = createPeerConnection(callerUserId, stream);
      
      await peerConnection.setRemoteDescription(offer);
      console.log('Remote description set for offer from:', callerUserId);
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log('Created and set local description for answer to:', callerUserId);
      
      socket.emit('answer', {
        targetUserId: callerUserId,
        answer,
        roomId
      });
      console.log('Answer sent to:', callerUserId);
    } catch (error) {
      console.error('Error handling offer from', callerUserId, ':', error);
    }
  };

  const handleIncomingAnswer = async (answer: RTCSessionDescriptionInit, answererUserId: string) => {
    try {
      const peerConnection = peerConnections.current.get(answererUserId);
      if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
        console.log('Remote description set for answer from:', answererUserId);
      } else {
        console.error('No peer connection found for answer from:', answererUserId);
      }
    } catch (error) {
      console.error('Error handling answer from', answererUserId, ':', error);
    }
  };

  const handleIncomingIceCandidate = async (candidate: RTCIceCandidateInit, senderUserId: string) => {
    try {
      const peerConnection = peerConnections.current.get(senderUserId);
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
        console.log('ICE candidate added from:', senderUserId);
      } else {
        console.log('Peer connection not ready for ICE candidate from:', senderUserId);
      }
    } catch (error) {
      console.error('Error handling ICE candidate from', senderUserId, ':', error);
    }
  };

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        console.log('Video toggled:', videoTrack.enabled);
        
        if (socket) {
          socket.emit('toggle-video', {
            roomId,
            isVideoOn: videoTrack.enabled
          });
        }
      }
    }
  }, [localStream, socket, roomId]);

  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
        console.log('Audio toggled:', audioTrack.enabled);
        
        if (socket) {
          socket.emit('toggle-audio', {
            roomId,
            isAudioOn: audioTrack.enabled
          });
        }
      }
    }
  }, [localStream, socket, roomId]);

  const toggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        
        // Replace video track in all peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        peerConnections.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          }
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        setIsScreenSharing(true);
        
        videoTrack.onended = () => {
          stopScreenShare();
        };
        
      } catch (error) {
        console.error('Error starting screen share:', error);
      }
    } else {
      stopScreenShare();
    }
  }, [isScreenSharing]);

  const stopScreenShare = useCallback(async () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      
      // Replace screen share track with camera track
      peerConnections.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      });
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
      
      setIsScreenSharing(false);
    }
  }, [localStream]);

  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy room ID:', error);
    }
  }, [roomId]);

  const shareRoom = useCallback(async () => {
    const shareUrl = `${window.location.origin}?room=${roomId}`;
    const shareData = {
      title: 'VideoMeet - Join my video call',
      text: `Join my video meeting on VideoMeet. Room ID: ${roomId}`,
      url: shareUrl
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback to copying URL
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [roomId]);

  const participantsList = Array.from(participants.values());
  const totalParticipants = participantsList.length + 1; // +1 for local user

  // Calculate grid layout based on number of participants
  const getGridLayout = (count: number) => {
    if (count === 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2 grid-rows-2';
    if (count <= 6) return 'grid-cols-3 grid-rows-2';
    if (count <= 9) return 'grid-cols-3 grid-rows-3';
    return 'grid-cols-4 grid-rows-3'; // For more than 9 participants
  };

  if (connectionStatus === 'failed') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h2 className="text-xl mb-4">接続に失敗しました</h2>
          <p className="text-gray-400 mb-6">サーバーに接続できませんでした。ネットワーク接続を確認してください。</p>
          <button
            onClick={onLeaveCall}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            ホームに戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setShowRoomInfo(!showRoomInfo)}
            className="flex items-center space-x-2 text-white hover:text-blue-400 transition-colors"
          >
            <h1 className="text-lg font-semibold">ルーム: {roomId}</h1>
            <Share2 size={18} />
          </button>
          <div className="flex items-center space-x-2 text-gray-400">
            <Users size={18} />
            <span>{totalParticipants}人</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' : 
            connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
          }`} />
          <span className="text-gray-400 text-sm">
            {connectionStatus === 'connected' ? '接続済み' : 
             connectionStatus === 'connecting' ? '接続中' : '接続失敗'}
          </span>
        </div>
      </div>

      {/* Room Info Panel */}
      {showRoomInfo && (
        <div className="bg-gray-800 border-t border-gray-700 p-4">
          <div className="max-w-md mx-auto bg-gray-700 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-3">会議を共有</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-gray-300 text-sm mb-1">ルームID</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={roomId}
                    readOnly
                    className="flex-1 bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:outline-none"
                  />
                  <button
                    onClick={copyRoomId}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center space-x-1"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    <span className="text-sm">{copied ? 'コピー済み!' : 'コピー'}</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-gray-300 text-sm mb-1">会議URL</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={`${window.location.origin}?room=${roomId}`}
                    readOnly
                    className="flex-1 bg-gray-600 text-white px-3 py-2 rounded border border-gray-500 focus:outline-none text-sm"
                  />
                  <button
                    onClick={shareRoom}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center space-x-1"
                  >
                    <Share2 size={16} />
                    <span className="text-sm">共有</span>
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowRoomInfo(false)}
              className="mt-3 w-full py-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Video Grid */}
      <div className="flex-1 p-4">
        <div className={`grid gap-2 h-full ${getGridLayout(totalParticipants)}`}>
          {/* Local Video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden min-h-0">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {!isVideoOn && (
              <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-xl font-semibold">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 px-2 py-1 rounded text-white text-xs">
              {userName} (あなた)
            </div>
            <div className="absolute top-2 right-2 flex space-x-1">
              {!isAudioOn && (
                <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                  <MicOff size={12} className="text-white" />
                </div>
              )}
              {isScreenSharing && (
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                  <Monitor size={12} className="text-white" />
                </div>
              )}
            </div>
          </div>

          {/* Remote Videos */}
          {participantsList.map((participant) => (
            <RemoteVideo
              key={participant.userId}
              participant={participant}
            />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 p-4">
        <div className="flex justify-center space-x-4">
          <button
            onClick={toggleAudio}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isAudioOn 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isAudioOn ? 'マイクをオフ' : 'マイクをオン'}
          >
            {isAudioOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>

          <button
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isVideoOn 
                ? 'bg-gray-700 hover:bg-gray-600 text-white' 
                : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
            title={isVideoOn ? 'カメラをオフ' : 'カメラをオン'}
          >
            {isVideoOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              isScreenSharing
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-white'
            }`}
            title={isScreenSharing ? '画面共有を停止' : '画面を共有'}
          >
            <Monitor size={20} />
          </button>

          <button
            onClick={() => setShowRoomInfo(!showRoomInfo)}
            className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center text-white transition-colors"
            title="ルーム情報"
          >
            <Share2 size={20} />
          </button>

          <button
            onClick={onLeaveCall}
            className="w-12 h-12 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white transition-colors"
            title="通話を終了"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface RemoteVideoProps {
  participant: Participant;
}

const RemoteVideo: React.FC<RemoteVideoProps> = ({ participant }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      console.log('Set video stream for participant:', participant.userId);
    }
  }, [participant.stream, participant.userId]);

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden min-h-0">
      {participant.stream && participant.isVideoOn !== false ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
          <div className="w-16 h-16 bg-gray-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xl font-semibold">
              {participant.userName.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 px-2 py-1 rounded text-white text-xs">
        {participant.userName}
      </div>
      
      <div className="absolute top-2 right-2 flex space-x-1">
        {participant.isAudioOn === false && (
          <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
            <MicOff size={12} className="text-white" />
          </div>
        )}
      </div>
    </div>
  );
};