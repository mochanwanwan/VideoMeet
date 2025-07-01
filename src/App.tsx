import React, { useState } from 'react';
import { JoinRoom } from './components/JoinRoom';
import { VideoCall } from './components/VideoCall';

interface CallState {
  isInCall: boolean;
  roomId: string;
  userName: string;
}

function App() {
  const [callState, setCallState] = useState<CallState>({
    isInCall: false,
    roomId: '',
    userName: ''
  });

  const handleJoinRoom = (roomId: string, userName: string) => {
    setCallState({
      isInCall: true,
      roomId,
      userName
    });
  };

  const handleLeaveCall = () => {
    setCallState({
      isInCall: false,
      roomId: '',
      userName: ''
    });
  };

  return (
    <div className="App">
      {callState.isInCall ? (
        <VideoCall
          roomId={callState.roomId}
          userName={callState.userName}
          onLeaveCall={handleLeaveCall}
        />
      ) : (
        <JoinRoom onJoinRoom={handleJoinRoom} />
      )}
    </div>
  );
}

export default App;