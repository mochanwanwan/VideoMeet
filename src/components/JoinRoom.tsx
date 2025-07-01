import React, { useState, useEffect } from 'react';
import { Video, Users, Plus, ArrowRight } from 'lucide-react';

interface JoinRoomProps {
  onJoinRoom: (roomId: string, userName: string) => void;
}

export const JoinRoom: React.FC<JoinRoomProps> = ({ onJoinRoom }) => {
  const [roomId, setRoomId] = useState('');
  const [userName, setUserName] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Check for room ID in URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl) {
      setRoomId(roomFromUrl.toUpperCase());
      setIsCreatingRoom(false);
    }
  }, []);

  const generateRoomId = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateRoom = () => {
    if (userName.trim()) {
      const newRoomId = generateRoomId();
      onJoinRoom(newRoomId, userName.trim());
    }
  };

  const handleJoinRoom = () => {
    if (userName.trim() && roomId.trim()) {
      onJoinRoom(roomId.trim().toUpperCase(), userName.trim());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingRoom) {
      handleCreateRoom();
    } else {
      handleJoinRoom();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white bg-opacity-20 rounded-full mb-4 backdrop-blur-sm">
            <Video size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">VideoMeet</h1>
          <p className="text-blue-200">Connect with people worldwide</p>
        </div>

        {/* Main Card */}
        <div className="bg-white bg-opacity-10 backdrop-blur-md rounded-2xl shadow-2xl border border-white border-opacity-20 p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Input */}
            <div>
              <label htmlFor="userName" className="block text-sm font-medium text-white mb-2">
                Your Name
              </label>
              <input
                type="text"
                id="userName"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-white bg-opacity-20 border border-white border-opacity-30 rounded-lg text-white placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm"
                required
              />
            </div>

            {/* Room Toggle */}
            <div className="flex bg-white bg-opacity-10 rounded-lg p-1">
              <button
                type="button"
                onClick={() => setIsCreatingRoom(true)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  isCreatingRoom
                    ? 'bg-white bg-opacity-20 text-white'
                    : 'text-blue-200 hover:text-white'
                }`}
              >
                <Plus size={16} className="inline mr-2" />
                Create Room
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingRoom(false)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  !isCreatingRoom
                    ? 'bg-white bg-opacity-20 text-white'
                    : 'text-blue-200 hover:text-white'
                }`}
              >
                <Users size={16} className="inline mr-2" />
                Join Room
              </button>
            </div>

            {/* Room ID Input (only for joining) */}
            {!isCreatingRoom && (
              <div>
                <label htmlFor="roomId" className="block text-sm font-medium text-white mb-2">
                  Room ID
                </label>
                <input
                  type="text"
                  id="roomId"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="Enter room ID"
                  className="w-full px-4 py-3 bg-white bg-opacity-20 border border-white border-opacity-30 rounded-lg text-white placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent backdrop-blur-sm"
                  maxLength={6}
                  required={!isCreatingRoom}
                />
                {roomId && (
                  <p className="mt-2 text-blue-200 text-sm">
                    Ready to join room: <span className="font-semibold">{roomId}</span>
                  </p>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!userName.trim() || (!isCreatingRoom && !roomId.trim())}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-500 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 transform hover:scale-105 disabled:scale-100 shadow-lg"
            >
              <span className="flex items-center justify-center">
                {isCreatingRoom ? 'Create & Join Room' : 'Join Room'}
                <ArrowRight size={20} className="ml-2" />
              </span>
            </button>
          </form>

          {/* Features */}
          <div className="mt-6 pt-6 border-t border-white border-opacity-20">
            <div className="grid grid-cols-2 gap-4 text-sm text-blue-200">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                HD Video & Audio
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                Screen Sharing
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                Global Access
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-400 rounded-full mr-2"></div>
                Easy Room Sharing
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-blue-200 text-sm">
          <p>Secure • Private • Free</p>
        </div>
      </div>
    </div>
  );
};