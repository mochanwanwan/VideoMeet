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

// より多くのSTUN/TURNサーバーを追加
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  // 複数の無料TURNサーバーを追加
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  // 追加のTURNサーバー
  {
    urls: 'turn:relay1.expressturn.com:3478',
    username: 'efJBIBF0YQAB8KAAAB',
    credential: 'sTunTurn'
  }
];

// 超低負荷設定
const ULTRA_LOW_VIDEO_CONSTRAINTS = {
  width: { ideal: 160, max: 240 },
  height: { ideal: 120, max: 180 },
  frameRate: { ideal: 8, max: 12 }
};

const ULTRA_LOW_SCREEN_CONSTRAINTS = {
  width: { ideal: 320, max: 480 },
  height: { ideal: 240, max: 360 },
  frameRate: { ideal: 5, max: 8 }
};

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 16000,
  channelCount: 1
};

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
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const userId = useRef(Math.random().toString(36).substr(2, 9));
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionMonitorRef = useRef<NodeJS.Timeout | null>(null);

  // デバッグ情報を追加する関数
  const addDebugInfo = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const debugMessage = `[${timestamp}] ${message}`;
    console.log('🔍 DEBUG:', debugMessage);
    setDebugInfo(prev => [...prev.slice(-20), debugMessage]); // 最新20件を保持
  }, []);

  // 接続状態を定期的に監視
  const startConnectionMonitor = useCallback(() => {
    if (connectionMonitorRef.current) {
      clearInterval(connectionMonitorRef.current);
    }
    
    connectionMonitorRef.current = setInterval(() => {
      peerConnections.current.forEach((pc, userId) => {
        const connectionState = pc.connectionState;
        const iceConnectionState = pc.iceConnectionState;
        const iceGatheringState = pc.iceGatheringState;
        
        addDebugInfo(`Connection Monitor - User: ${userId}, Connection: ${connectionState}, ICE: ${iceConnectionState}, Gathering: ${iceGatheringState}`);
        
        // 接続が不安定な場合の対処
        if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
          addDebugInfo(`⚠️ Connection issue detected for ${userId}, attempting recovery`);
          
          // より積極的な再接続
          setTimeout(() => {
            if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
              addDebugInfo(`🔄 Restarting ICE for ${userId}`);
              pc.restartIce();
            }
          }, 1000);
        }
      });
    }, 5000); // 5秒ごとに監視
  }, [addDebugInfo]);

  // Initialize WebRTC and Socket connection
  useEffect(() => {
    const initializeCall = async () => {
      try {
        addDebugInfo('🚀 Initializing call...');
        setError(null);
        
        // 超低品質設定でユーザーメディアを取得
        const stream = await navigator.mediaDevices.getUserMedia({
          video: ULTRA_LOW_VIDEO_CONSTRAINTS,
          audio: AUDIO_CONSTRAINTS
        });
        
        addDebugInfo(`📹 Got local stream with ${stream.getTracks().length} tracks`);
        setLocalStream(stream);
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Initialize socket connection
        const socketUrl = window.location.origin;
        
        addDebugInfo(`🔌 Connecting to socket server: ${socketUrl}`);
        const newSocket = io(socketUrl, {
          transports: ['websocket', 'polling'],
          timeout: 20000,
          forceNew: true,
          reconnection: true,
          reconnectionAttempts: 15,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          maxReconnectionAttempts: 15
        });
        
        socketRef.current = newSocket;
        setSocket(newSocket);

        // ハートビート機能を追加してコネクションを維持
        const startHeartbeat = () => {
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
          }
          heartbeatIntervalRef.current = setInterval(() => {
            if (newSocket.connected) {
              newSocket.emit('ping');
              addDebugInfo('💓 Heartbeat sent');
            }
          }, 20000); // 20秒間隔
        };

        // Socket event handlers
        newSocket.on('connect', () => {
          addDebugInfo(`✅ Socket connected with ID: ${newSocket.id}`);
          setConnectionStatus('connected');
          setError(null);
          setReconnectAttempts(0);
          startHeartbeat();
          startConnectionMonitor();
          
          // Join room after socket connection is established
          addDebugInfo(`🚪 Joining room: ${roomId} as user: ${userId.current} (${userName})`);
          newSocket.emit('join-room', {
            roomId,
            userId: userId.current,
            userName
          });
        });

        newSocket.on('connect_error', (error) => {
          addDebugInfo(`❌ Socket connection error: ${error.message}`);
          setConnectionStatus('failed');
          setError('サーバーに接続できません');
          setReconnectAttempts(prev => prev + 1);
        });

        newSocket.on('disconnect', (reason) => {
          addDebugInfo(`🔌 Socket disconnected: ${reason}`);
          setConnectionStatus('connecting');
          
          if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
          }
          
          // 自動再接続の試行
          if (reason === 'io server disconnect') {
            setTimeout(() => {
              if (!newSocket.connected) {
                addDebugInfo('🔄 Attempting socket reconnection');
                newSocket.connect();
              }
            }, 1000);
          }
        });

        newSocket.on('pong', () => {
          addDebugInfo('💓 Received pong from server');
        });

        // WebRTC signaling handlers
        newSocket.on('user-joined', async ({ userId: newUserId, userName: newUserName }) => {
          addDebugInfo(`👤 User joined: ${newUserId} (${newUserName})`);
          
          setParticipants(prev => {
            const updated = new Map(prev);
            if (!updated.has(newUserId)) {
              addDebugInfo(`➕ Adding new participant: ${newUserId}`);
              updated.set(newUserId, { 
                userId: newUserId, 
                userName: newUserName, 
                isVideoOn: true, 
                isAudioOn: true 
              });
            }
            return updated;
          });

          // 少し遅延を入れてからオファーを作成
          setTimeout(() => {
            createOfferForUser(newUserId, stream, newSocket);
          }, 1000); // 1秒の遅延
        });

        newSocket.on('room-participants', (participantsList: Participant[]) => {
          addDebugInfo(`👥 Existing participants: ${participantsList.length}`);
          
          setParticipants(prev => {
            const updated = new Map(prev);
            participantsList.forEach(participant => {
              if (participant.userId !== userId.current) {
                addDebugInfo(`➕ Adding existing participant: ${participant.userId} (${participant.userName})`);
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
          addDebugInfo(`📞 Received offer from: ${callerUserId}`);
          await handleIncomingOffer(offer, callerUserId, stream, newSocket);
        });

        newSocket.on('answer', async ({ answer, answererUserId }) => {
          addDebugInfo(`📞 Received answer from: ${answererUserId}`);
          await handleIncomingAnswer(answer, answererUserId);
        });

        newSocket.on('ice-candidate', async ({ candidate, senderUserId }) => {
          addDebugInfo(`🧊 Received ICE candidate from: ${senderUserId} (type: ${candidate.candidate?.split(' ')[7] || 'unknown'})`);
          await handleIncomingIceCandidate(candidate, senderUserId);
        });

        newSocket.on('user-left', ({ userId: leftUserId, userName: leftUserName }) => {
          addDebugInfo(`👋 User left: ${leftUserId} (${leftUserName})`);
          
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
            addDebugInfo(`🔒 Closed peer connection for: ${leftUserId}`);
          }
        });

        newSocket.on('user-video-toggled', ({ userId: toggledUserId, isVideoOn: videoOn }) => {
          addDebugInfo(`📹 User video toggled: ${toggledUserId} -> ${videoOn}`);
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
          addDebugInfo(`🎤 User audio toggled: ${toggledUserId} -> ${audioOn}`);
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
        addDebugInfo(`❌ Error initializing call: ${error}`);
        setConnectionStatus('failed');
        setError('カメラまたはマイクにアクセスできません');
      }
    };

    initializeCall();

    return () => {
      addDebugInfo('🧹 Cleanup started');
      
      // Clear intervals
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (connectionMonitorRef.current) {
        clearInterval(connectionMonitorRef.current);
      }
      
      // Stop all tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          track.stop();
          addDebugInfo(`🛑 Stopped track: ${track.kind}`);
        });
      }
      
      // Close all peer connections
      peerConnections.current.forEach((pc, userId) => {
        pc.close();
        addDebugInfo(`🔒 Closed peer connection for: ${userId}`);
      });
      peerConnections.current.clear();
      
      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        addDebugInfo('🔌 Socket disconnected');
      }
    };
  }, [roomId, userName, addDebugInfo, startConnectionMonitor]);

  const createPeerConnection = (targetUserId: string, stream: MediaStream) => {
    addDebugInfo(`🔗 Creating peer connection for: ${targetUserId}`);
    
    const peerConnection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    // Add local stream tracks
    stream.getTracks().forEach(track => {
      addDebugInfo(`➕ Adding ${track.kind} track to peer connection for: ${targetUserId}`);
      peerConnection.addTrack(track, stream);
    });

    // Handle incoming stream
    peerConnection.ontrack = (event) => {
      addDebugInfo(`📺 Received remote ${event.track.kind} track from: ${targetUserId}`);
      const [remoteStream] = event.streams;
      
      // ストリームの状態を監視
      remoteStream.getTracks().forEach(track => {
        track.onended = () => {
          addDebugInfo(`🔚 Remote ${track.kind} track ended from: ${targetUserId}`);
        };
        track.onmute = () => {
          addDebugInfo(`🔇 Remote ${track.kind} track muted from: ${targetUserId}`);
        };
        track.onunmute = () => {
          addDebugInfo(`🔊 Remote ${track.kind} track unmuted from: ${targetUserId}`);
        };
      });
      
      setParticipants(prev => {
        const updated = new Map(prev);
        const participant = updated.get(targetUserId);
        if (participant) {
          addDebugInfo(`📺 Setting stream for participant: ${targetUserId}`);
          updated.set(targetUserId, { ...participant, stream: remoteStream });
        }
        return updated;
      });
    };

    // Handle ICE candidates with better error handling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        const candidateType = event.candidate.candidate?.split(' ')[7] || 'unknown';
        addDebugInfo(`🧊 Sending ICE candidate to ${targetUserId} (type: ${candidateType})`);
        socketRef.current.emit('ice-candidate', {
          targetUserId,
          candidate: event.candidate,
          roomId
        });
      } else if (!event.candidate) {
        addDebugInfo(`✅ ICE gathering complete for: ${targetUserId}`);
      }
    };

    // Handle connection state changes with aggressive reconnection
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      addDebugInfo(`🔄 Peer connection state with ${targetUserId}: ${state}`);
      
      if (state === 'failed') {
        addDebugInfo(`❌ Peer connection failed with ${targetUserId}, restarting ICE`);
        peerConnection.restartIce();
      } else if (state === 'disconnected') {
        addDebugInfo(`⚠️ Peer connection disconnected with ${targetUserId}, scheduling reconnect`);
        setTimeout(() => {
          if (peerConnection.connectionState === 'disconnected' || 
              peerConnection.connectionState === 'failed') {
            addDebugInfo(`🔄 Attempting ICE restart for: ${targetUserId}`);
            peerConnection.restartIce();
          }
        }, 2000);
      } else if (state === 'connected') {
        addDebugInfo(`✅ Peer connection established successfully with: ${targetUserId}`);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      addDebugInfo(`🧊 ICE connection state with ${targetUserId}: ${iceState}`);
      
      if (iceState === 'failed') {
        addDebugInfo(`❌ ICE connection failed with ${targetUserId}, restarting`);
        peerConnection.restartIce();
      } else if (iceState === 'disconnected') {
        addDebugInfo(`⚠️ ICE connection disconnected with ${targetUserId}`);
        setTimeout(() => {
          if (peerConnection.iceConnectionState === 'disconnected' || 
              peerConnection.iceConnectionState === 'failed') {
            addDebugInfo(`🔄 ICE restart due to disconnection: ${targetUserId}`);
            peerConnection.restartIce();
          }
        }, 3000);
      } else if (iceState === 'connected' || iceState === 'completed') {
        addDebugInfo(`✅ ICE connection established with: ${targetUserId}`);
      }
    };

    // ICE gathering state
    peerConnection.onicegatheringstatechange = () => {
      addDebugInfo(`🧊 ICE gathering state with ${targetUserId}: ${peerConnection.iceGatheringState}`);
    };

    peerConnections.current.set(targetUserId, peerConnection);
    return peerConnection;
  };

  const createOfferForUser = async (targetUserId: string, stream: MediaStream, socket: Socket) => {
    try {
      addDebugInfo(`📞 Creating offer for user: ${targetUserId}`);
      const peerConnection = createPeerConnection(targetUserId, stream);
      
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
        iceRestart: false
      });
      
      await peerConnection.setLocalDescription(offer);
      addDebugInfo(`📞 Local description set, sending offer to: ${targetUserId}`);
      
      socket.emit('offer', {
        targetUserId,
        offer,
        roomId
      });
    } catch (error) {
      addDebugInfo(`❌ Error creating offer for ${targetUserId}: ${error}`);
    }
  };

  const handleIncomingOffer = async (offer: RTCSessionDescriptionInit, callerUserId: string, stream: MediaStream, socket: Socket) => {
    try {
      addDebugInfo(`📞 Handling incoming offer from: ${callerUserId}`);
      const peerConnection = createPeerConnection(callerUserId, stream);
      
      await peerConnection.setRemoteDescription(offer);
      addDebugInfo(`📞 Remote description set for offer from: ${callerUserId}`);
      
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      addDebugInfo(`📞 Created and set local description for answer to: ${callerUserId}`);
      
      socket.emit('answer', {
        targetUserId: callerUserId,
        answer,
        roomId
      });
      addDebugInfo(`📞 Answer sent to: ${callerUserId}`);
    } catch (error) {
      addDebugInfo(`❌ Error handling offer from ${callerUserId}: ${error}`);
    }
  };

  const handleIncomingAnswer = async (answer: RTCSessionDescriptionInit, answererUserId: string) => {
    try {
      const peerConnection = peerConnections.current.get(answererUserId);
      if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
        addDebugInfo(`📞 Remote description set for answer from: ${answererUserId}`);
      } else {
        addDebugInfo(`❌ No peer connection found for answer from: ${answererUserId}`);
      }
    } catch (error) {
      addDebugInfo(`❌ Error handling answer from ${answererUserId}: ${error}`);
    }
  };

  const handleIncomingIceCandidate = async (candidate: RTCIceCandidateInit, senderUserId: string) => {
    try {
      const peerConnection = peerConnections.current.get(senderUserId);
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
        const candidateType = candidate.candidate?.split(' ')[7] || 'unknown';
        addDebugInfo(`✅ ICE candidate added from ${senderUserId} (type: ${candidateType})`);
      } else {
        addDebugInfo(`⚠️ Peer connection not ready for ICE candidate from: ${senderUserId}`);
      }
    } catch (error) {
      addDebugInfo(`❌ Error handling ICE candidate from ${senderUserId}: ${error}`);
    }
  };

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
        addDebugInfo(`📹 Video toggled: ${videoTrack.enabled}`);
        
        if (socket) {
          socket.emit('toggle-video', {
            roomId,
            isVideoOn: videoTrack.enabled
          });
        }
      }
    }
  }, [localStream, socket, roomId, addDebugInfo]);

  const toggleAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
        addDebugInfo(`🎤 Audio toggled: ${audioTrack.enabled}`);
        
        if (socket) {
          socket.emit('toggle-audio', {
            roomId,
            isAudioOn: audioTrack.enabled
          });
        }
      }
    }
  }, [localStream, socket, roomId, addDebugInfo]);

  const toggleScreenShare = useCallback(async () => {
    if (!isScreenSharing) {
      try {
        addDebugInfo('🖥️ Starting screen share');
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: ULTRA_LOW_SCREEN_CONSTRAINTS,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000
          }
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
        addDebugInfo('✅ Screen share started');
        
        videoTrack.onended = () => {
          addDebugInfo('🖥️ Screen share ended by user');
          stopScreenShare();
        };
        
      } catch (error) {
        addDebugInfo(`❌ Error starting screen share: ${error}`);
      }
    } else {
      stopScreenShare();
    }
  }, [isScreenSharing, addDebugInfo]);

  const stopScreenShare = useCallback(async () => {
    if (localStream) {
      addDebugInfo('🖥️ Stopping screen share');
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
      addDebugInfo('✅ Screen share stopped');
    }
  }, [localStream, addDebugInfo]);

  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addDebugInfo('📋 Room ID copied to clipboard');
    } catch (error) {
      addDebugInfo(`❌ Failed to copy room ID: ${error}`);
    }
  }, [roomId, addDebugInfo]);

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
        addDebugInfo('📤 Room shared via native share');
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        addDebugInfo('📋 Room URL copied to clipboard');
      }
    } catch (error) {
      addDebugInfo(`❌ Error sharing: ${error}`);
    }
  }, [roomId, addDebugInfo]);

  const participantsList = Array.from(participants.values());
  const totalParticipants = participantsList.length + 1;

  // Calculate grid layout based on number of participants
  const getGridLayout = (count: number) => {
    if (count === 1) return 'grid-cols-1';
    if (count === 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2 grid-rows-2';
    if (count <= 6) return 'grid-cols-3 grid-rows-2';
    if (count <= 9) return 'grid-cols-3 grid-rows-3';
    return 'grid-cols-4 grid-rows-3';
  };

  // エラー状態の表示
  if (error && reconnectAttempts > 10) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white max-w-md mx-auto p-6">
          <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <VideoOff size={32} className="text-white" />
          </div>
          <h2 className="text-xl mb-4">接続エラー</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => window.location.reload()}
              className="w-full px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              再読み込み
            </button>
            <button
              onClick={onLeaveCall}
              className="w-full px-6 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg transition-colors"
            >
              ホームに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (connectionStatus === 'connecting') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h2 className="text-xl mb-2">接続中...</h2>
          <p className="text-gray-400">
            {reconnectAttempts > 0 ? `再接続試行中 (${reconnectAttempts}/15)` : 'サーバーに接続しています'}
          </p>
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
          <div className="text-xs text-green-400 bg-green-900 px-2 py-1 rounded">
            超低負荷モード (160p)
          </div>
          <button
            onClick={() => {
              console.log('=== DEBUG INFO ===');
              debugInfo.forEach(info => console.log(info));
              console.log('=== PEER CONNECTIONS ===');
              peerConnections.current.forEach((pc, userId) => {
                console.log(`${userId}: connection=${pc.connectionState}, ice=${pc.iceConnectionState}`);
              });
            }}
            className="text-xs text-blue-400 bg-blue-900 px-2 py-1 rounded hover:bg-blue-800"
            title="デバッグ情報をコンソールに出力"
          >
            DEBUG
          </button>
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
            <div className="mt-3 p-2 bg-green-900 rounded text-green-200 text-xs">
              <strong>超省電力モード:</strong> 160p解像度・8fps・複数TURNサーバー対応
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

      {/* Video Grid - 非常に小さく表示 */}
      <div className="flex-1 p-1">
        <div className={`grid gap-1 h-full ${getGridLayout(totalParticipants)}`}>
          {/* Local Video - 16:9アスペクト比を維持、非常に小さく */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video max-h-32">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
            {!isVideoOn && (
              <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
                <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-semibold">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-1 left-1 bg-black bg-opacity-60 px-1 py-0.5 rounded text-white text-xs">
              {userName} (あなた)
            </div>
            <div className="absolute top-1 right-1 flex space-x-1">
              {!isAudioOn && (
                <div className="w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
                  <MicOff size={6} className="text-white" />
                </div>
              )}
              {isScreenSharing && (
                <div className="w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center">
                  <Monitor size={6} className="text-white" />
                </div>
              )}
            </div>
          </div>

          {/* Remote Videos - 非常に小さく表示 */}
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
      console.log('🔍 DEBUG: Set video stream for participant:', participant.userId);
      
      const videoElement = videoRef.current;
      
      const handleLoadedMetadata = () => {
        console.log('🔍 DEBUG: Video metadata loaded for:', participant.userId);
      };
      
      const handleCanPlay = () => {
        console.log('🔍 DEBUG: Video can play for:', participant.userId);
      };
      
      const handleError = (e: Event) => {
        console.error('🔍 DEBUG: Video error for:', participant.userId, e);
      };
      
      videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.addEventListener('canplay', handleCanPlay);
      videoElement.addEventListener('error', handleError);
      
      return () => {
        videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoElement.removeEventListener('canplay', handleCanPlay);
        videoElement.removeEventListener('error', handleError);
      };
    }
  }, [participant.stream, participant.userId]);

  return (
    <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-video max-h-32">
      {participant.stream && participant.isVideoOn !== false ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
          <div className="w-6 h-6 bg-gray-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-semibold">
              {participant.userName.charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
      )}
      
      <div className="absolute bottom-1 left-1 bg-black bg-opacity-60 px-1 py-0.5 rounded text-white text-xs">
        {participant.userName}
      </div>
      
      <div className="absolute top-1 right-1 flex space-x-1">
        {participant.isAudioOn === false && (
          <div className="w-3 h-3 bg-red-500 rounded-full flex items-center justify-center">
            <MicOff size={6} className="text-white" />
          </div>
        )}
      </div>
    </div>
  );
};