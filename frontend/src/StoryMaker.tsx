import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface StoryData {
  childName: string;
  age: string;
  theme: string;
  length: string;
  userId: string;
}

interface StoryMetadata {
  storyId: string;
  status: 'pending' | 'complete';
  audioStatus: 'pending' | 'complete';
  imageStatus: 'pending' | 'complete';
  audioUrl?: string;
  imageUrl?: string;
  textUrl?: string;
  storyText?: string;
}

const api = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_API_URL,
  headers: {
    'Content-Type': 'application/json',
    // 'Access-Control-Allow-Origin': '*'
  }
});

const StoryMaker: React.FC = () => {
  const [storyData, setStoryData] = useState<StoryData>({
    childName: '',
    age: '',
    theme: '',
    length: '',
    userId: 'user-123'
  });
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [metadata, setMetadata] = useState<StoryMetadata | null>(null);
  const [error, setError] = useState('');
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStoryData(prev => ({ ...prev, [name]: value }));
  };

  const generateStory = async () => {
    setIsGenerating(true);
    setError('');
    
    try {
      const response = await api.post('/story', storyData);
      const storyId = response.data.storyId;
      
      pollMetadata(storyId);
    } catch (err) {
      setError('Failed to start story generation');
      setIsGenerating(false);
    }
  };

  const pollMetadata = async (storyId: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes at 10 second intervals
    
    const interval = setInterval(async () => {
      try {
        const response = await api.get(`/metadata/${storyId}`);
        const data = response.data;
        
        setMetadata(data);
        
        if (data.status === 'complete' && 
            data.audioStatus === 'complete' && 
            data.imageStatus === 'complete') {
          clearInterval(interval);
          setIsGenerating(false);
          
          if (data.textUrl && !data.storyText) {
            fetchStoryText(data.textUrl);
          }
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setIsGenerating(false);
          setError('Story generation timed out');
        }
      } catch (err) {
        clearInterval(interval);
        setIsGenerating(false);
        setError('Error fetching story status');
      }
    }, 10000); // Poll every 10 seconds
  };

  const fetchStoryText = async (url: string) => {
    try {
      const response = await api.get(url);
      setMetadata(prev => ({
        ...prev!,
        storyText: response.data
      }));
    } catch (err) {
      setError('Failed to fetch story text');
    }
  };

  return (
    <div className="story-maker" style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)' }}>
      <h1 style={{ color: '#ff6b6b', fontFamily: '"Comic Sans MS", cursive, sans-serif' }}>✨ Magic Story Maker ✨</h1>
      
      {!isGenerating && !metadata && (
        <div className="story-form" style={{ background: 'white', borderRadius: '20px', padding: '25px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Child's name:</label>
            <input 
              type="text" 
              name="childName" 
              value={storyData.childName} 
              onChange={handleInputChange} 
              placeholder="John"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '18px',
                border: '1px solid #ccc',
                borderRadius: '5px'
              }}
            />
          </div>
          
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>How old is the main person?</label>
            <input 
              type="text" 
              name="age" 
              value={storyData.age} 
              onChange={handleInputChange} 
              placeholder="5 years old"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '18px',
                border: '1px solid #ccc',
                borderRadius: '5px'
              }}
            />
          </div>
          
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Theme of the story:</label>
            <input 
              type="text" 
              name="theme" 
              value={storyData.theme} 
              onChange={handleInputChange} 
              placeholder="Adventure"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '18px',
                border: '1px solid #ccc',
                borderRadius: '5px'
              }}
            />
          </div>
          
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>How long should the story be?</label>
            <select 
              name="length" 
              value={storyData.length} 
              onChange={handleInputChange}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '18px',
                border: '1px solid #ccc',
                borderRadius: '5px'
              }}
            >
              <option value="">Select length</option>
              <option value="short">Short (1-2 minutes)</option>
              <option value="medium">Medium (3-5 minutes)</option>
              <option value="long">Long (5+ minutes)</option>
            </select>
          </div>
          
          <button 
            onClick={generateStory} 
            disabled={!(storyData.childName && storyData.age && storyData.theme && storyData.length)}
            style={{
              background: 'linear-gradient(to right, #ff758c, #ff7eb3)',
              color: 'white',
              border: 'none',
              padding: '12px 25px',
              borderRadius: '50px',
              cursor: 'pointer',
              fontSize: '18px',
              fontWeight: 'bold',
              boxShadow: '0 4px 8px rgba(255, 117, 140, 0.3)',
              transition: 'all 0.3s ease'
            }}
          >
            🎩 Make My Story!
          </button>
        </div>
      )}
      
      {isGenerating && (
        <div className="loading" style={{ textAlign: 'center', padding: '50px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>Generating your magical story...</h2>
          <p style={{ fontSize: '18px', color: '#666' }}>Please wait while we create your story, audio, and cover image.</p>
          <div className="spinner" style={{ borderTopColor: '#ff6b6b' }}></div>
        </div>
      )}
      
      {metadata && metadata.status === 'complete' && (
        <div className="story-result" style={{ padding: '50px', textAlign: 'center' }}>
          {metadata.imageUrl && (
            <div className="cover-image" style={{ marginBottom: '20px' }}>
              <img src={metadata.imageUrl} alt="Story cover" style={{ width: '100%', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }} />
            </div>
          )}
          
          {metadata.audioUrl && (
            <div className="audio-player" style={{ marginBottom: '20px' }}>
              <audio controls src={metadata.audioUrl} style={{ width: '100%' }}></audio>
            </div>
          )}
          
          {metadata.storyText && (
            <div className="story-text" style={{ marginBottom: '20px' }}>
              <details style={{ width: '100%' }}>
                <summary style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Read the story</summary>
                <p style={{ fontSize: '18px', color: '#666' }}>{metadata.storyText}</p>
              </details>
            </div>
          )}
          
          <button 
            onClick={() => {
              setMetadata(null);
              setIsGenerating(false);
            }}
            style={{
              background: 'linear-gradient(to right, #ff758c, #ff7eb3)',
              color: 'white',
              border: 'none',
              padding: '12px 25px',
              borderRadius: '50px',
              cursor: 'pointer',
              fontSize: '18px',
              fontWeight: 'bold',
              boxShadow: '0 4px 8px rgba(255, 117, 140, 0.3)',
              transition: 'all 0.3s ease'
            }}
          >
            🎩 Make Another Story
          </button>
        </div>
      )}
      
      {error && <div className="error" style={{ padding: '20px', background: 'white', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>{error}</div>}
    </div>
  );
};

export default StoryMaker;
