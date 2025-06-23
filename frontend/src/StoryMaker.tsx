import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { FloatingStars, CharacterIllustration } from './components/MagicalEffects';
import useSound from 'use-sound';
import confetti from 'canvas-confetti';
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStoryData(prev => ({ ...prev, [name]: value }));
  };

  const handleTileSelect = (field: 'theme' | 'length', value: string) => {
    setStoryData(prev => ({ ...prev, [field]: value }));
  };

  const [playWoosh] = useSound('/sounds/woosh.mp3');
  const [playSuccess] = useSound('/sounds/success.mp3');

  const generateStory = async () => {
    playWoosh();
    setIsGenerating(true);
    setError('');
    
    try {
      const response = await api.post('/story', storyData);
      const storyId = response.data.storyId;
      
      // Trigger confetti
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
      
      pollMetadata(storyId);
    } catch (err) {
      setError('Failed to start story generation');
      setIsGenerating(false);
    }
  };

  const getPresignedUrl = async (s3Url: string): Promise<string> => {
    console.log('getPresignedUrl called with:', s3Url);
    try {
      if (s3Url && s3Url.startsWith('s3://')) {
        // Parse the S3 URL to extract the key
        // Format: s3://bucket-name/path/to/file
        const s3Parts = s3Url.replace('s3://', '').split('/');
        const bucketName = s3Parts[0];
        const key = s3Parts.slice(1).join('/');
        
        console.log('Parsed S3 URL:', { bucketName, key });
        console.log('Requesting presigned URL for:', { key, operation: 'get' });
        
        // Log the API endpoint being used
        console.log('API endpoint:', `${api.defaults.baseURL}/url`);
        
        const response = await api.post('/url', { 
          key: key,
          operation: 'get'
        });
        
        console.log('Presigned URL response status:', response.status);
        console.log('Presigned URL response data:', response.data);
        
        if (response.data && response.data.url) {
          console.log('Returning presigned URL:', response.data.url);
          return response.data.url;
        } else {
          console.error('No URL in response data:', response.data);
          return s3Url; // Return original URL if no presigned URL was returned
        }
      }
      console.log('URL is not an S3 URL, returning as is:', s3Url);
      return s3Url;
    } catch (err: any) {
      console.error('Error getting presigned URL:', err);
      if (err.response) {
        console.error('Error response data:', err.response.data);
        console.error('Error response status:', err.response.status);
      }
      setError('Failed to get presigned URL');
      return s3Url;
    }
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const pollMetadata = async (storyId: string) => {
    let attempts = 0;
    const maxAttempts = 60;

    const poll = async () => {
      const currentMetadata = metadataRef.current;

      if (currentMetadata?.storyText && currentMetadata?.audioUrl && currentMetadata?.imageUrl) {
        console.log('All content loaded, stopping polling.');
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }

      if (attempts >= maxAttempts) {
        console.log('Polling timed out.');
        if (intervalRef.current) clearInterval(intervalRef.current);
        setError('Story generation timed out');
        setIsGenerating(false);
        return;
      }
      attempts++;

      try {
        console.log(`Polling attempt ${attempts} for story ID: ${storyId}`);
        const response = await api.get(`/metadata/${storyId}`);
        const data = response.data;

        let needsUpdate = false;
        const newMetadata = { ...currentMetadata, ...data };

        const textUrl = data.textUrl;
        let bucketName = '';
        if (textUrl && textUrl.startsWith('s3://')) {
          bucketName = textUrl.replace('s3://', '').split('/')[0];
        }

        const promises = [];

        if (textUrl && !newMetadata.storyText) {
          promises.push(
            fetchStoryText(textUrl).then(text => {
              if (text) {
                newMetadata.storyText = text;
                needsUpdate = true;
              }
            })
          );
        }

        if (bucketName && data.audioStatus === 'complete' && !newMetadata.audioUrl) {
          const audioS3Url = `s3://${bucketName}/stories/${storyId}/audio.mp3`;
          promises.push(
            getPresignedUrl(audioS3Url).then(url => {
              if (url !== audioS3Url) {
                newMetadata.audioUrl = url;
                needsUpdate = true;
              }
            })
          );
        }

        if (bucketName && data.imageStatus === 'complete' && !newMetadata.imageUrl) {
          const imageS3Url = `s3://${bucketName}/stories/${storyId}/cover.png`;
          promises.push(
            getPresignedUrl(imageS3Url).then(url => {
              if (url !== imageS3Url) {
                newMetadata.imageUrl = url;
                needsUpdate = true;
              }
            })
          );
        }

        await Promise.all(promises);

        if (needsUpdate) {
          setMetadata(newMetadata);
        }

        // Final check to stop polling
        if (newMetadata.storyText && newMetadata.audioUrl && newMetadata.imageUrl) {
          console.log('All content now loaded, stopping polling for good.');
          if (intervalRef.current) clearInterval(intervalRef.current);
        }

      } catch (err) {
        console.error('Error during polling:', err);
        setError('An error occurred while fetching story status.');
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    };

    intervalRef.current = setInterval(poll, 3000);
    poll(); // Initial poll right away
  };

  const fetchStoryText = async (url: string): Promise<string | null> => {
    try {
      console.log('Fetching story text from URL:', url);
      if (url.startsWith('s3://')) {
        // Get a presigned URL for the S3 object
        const presignedUrl = await getPresignedUrl(url);
        console.log('Got presigned URL for story text:', presignedUrl);
        
        // Use the presigned URL to fetch the story text
        const storyTextResponse = await axios.get(presignedUrl);
        console.log('Story text fetched successfully, length:', storyTextResponse.data.length);
        return storyTextResponse.data;
      } else {
        // Direct URL fetch
        const response = await api.get(url);
        console.log('Story text fetched directly, length:', response.data.length);
        return response.data;
      }
    } catch (err) {
      console.error('Error fetching story text:', err);
      setError('Failed to fetch story text');
      return null;
    }
  };

  const ThemeTile = styled.div<{ selected: boolean }>`
    padding: 10px 20px;
    font-size: 1rem;
    border: 2px solid #8a2be2;
    border-radius: 20px;
    cursor: pointer;
    background: ${props => props.selected ? '#8a2be2' : '#fff'};
    color: ${props => props.selected ? '#fff' : '#8a2be2'};
    font-weight: bold;
    transition: all 0.3s ease;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    transform: ${props => props.selected ? 'scale(1.05)' : 'scale(1)'};
    
    &:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 12px rgba(0,0,0,0.15);
    }
  `;

  const LengthOption = styled.div<{ selected: boolean }>`
    padding: 10px 20px;
    font-size: 1rem;
    border: 2px solid #8a2be2;
    border-radius: 20px;
    cursor: pointer;
    background: ${props => props.selected ? '#8a2be2' : '#fff'};
    color: ${props => props.selected ? '#fff' : '#8a2be2'};
    font-weight: bold;
    transition: all 0.3s ease;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    transform: ${props => props.selected ? 'scale(1.05)' : 'scale(1)'};
    
    &:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 12px rgba(0,0,0,0.15);
    }
  `;

  const GenerateButton = styled.button`
    background: linear-gradient(135deg, #8a2be2 0%, #ff00ff 100%);
    color: white;
    border: none;
    padding: 15px 30px;
    border-radius: 30px;
    cursor: pointer;
    font-size: 1.2rem;
    font-weight: bold;
    box-shadow: 0 6px 12px rgba(138, 43, 226, 0.3);
    display: block;
    margin: 30px auto;
    transition: all 0.3s ease;
    transform: scale(1);
    
    &:hover {
      transform: scale(1.05);
      box-shadow: 0 8px 16px rgba(138, 43, 226, 0.4);
    }
    
    &:disabled {
      opacity: 0.7;
      cursor: not-allowed;
      transform: scale(1);
    }
  `;

  return (
    <div className="story-maker" style={{ 
      background: 'linear-gradient(135deg, #f6e6ff 0%, #c8f2ff 100%)',
      minHeight: '100vh',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <FloatingStars count={50} />
      <CharacterIllustration />
      <h1 style={{ 
        color: '#8a2be2', 
        fontFamily: '"Luckiest Guy", cursive, sans-serif',
        fontSize: '3rem',
        textAlign: 'center',
        margin: '20px 0 40px',
        textShadow: '3px 3px 0 #ffd700',
        letterSpacing: '1px'
      }}>
        <span style={{ color: '#ff69b4' }}>✨</span> Magic Story Maker <span style={{ color: '#ff69b4' }}>✨</span>
      </h1>
      
      {!isGenerating && !metadata && (
        <div className="story-form" style={{ background: 'white', borderRadius: '20px', padding: '25px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
          <div style={{ 
            display: 'flex', 
            gap: '20px', 
            marginBottom: '20px',
            background: 'rgba(255,255,255,0.8)',
            padding: '20px',
            borderRadius: '20px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)'
          }}>
            <div className="form-group" style={{ flex: 1 }}>
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
            <div className="form-group" style={{ flex: 1 }}>
              <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Age:</label>
              <input 
                type="text" 
                name="age" 
                value={storyData.age} 
                onChange={handleInputChange} 
                placeholder="5"
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '18px',
                  border: '1px solid #ccc',
                  borderRadius: '5px'
                }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Theme of the story:</label>
            <div className="tiles-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
              {['Forest', 'Fantasy', 'Adventure', 'Space'].map(theme => (
                <ThemeTile 
                  key={theme} 
                  selected={storyData.theme === theme.toLowerCase()}
                  onClick={() => handleTileSelect('theme', theme.toLowerCase())}
                >
                  {theme}
                </ThemeTile>
              ))}
            </div>
            <input 
              type="text" 
              name="theme" 
              value={storyData.theme} 
              onChange={handleInputChange} 
              placeholder="Or type your own theme"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '18px',
                border: '1px solid #ccc',
                borderRadius: '5px',
                marginTop: '10px'
              }}
            />
          </div>
          
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>How long should the story be?</label>
            <div className="tiles-container" style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
              {[
                { value: 'short', label: 'Short' },
                { value: 'medium', label: 'Medium' },
                { value: 'long', label: 'Long' }
              ].map(lengthOption => (
                <LengthOption
                  key={lengthOption.value}
                  selected={storyData.length === lengthOption.value}
                  onClick={() => handleTileSelect('length', lengthOption.value)}
                >
                  {lengthOption.label}
                </LengthOption>
              ))}
            </div>
          </div>
          
          <GenerateButton 
            onClick={generateStory} 
            disabled={!(storyData.childName && storyData.age && storyData.theme && storyData.length)}
          >
            🎩 Make My Story!
          </GenerateButton>
        </div>
      )}
      
      {isGenerating && (
        <div className="story-result" style={{ padding: '50px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333' }}>
            {metadata && metadata.status === 'complete' && metadata.audioStatus === 'complete' && metadata.imageStatus === 'complete'
              ? 'Your magical story is ready!'
              : 'Generating your magical story...'}
          </h2>

          {metadata ? (
            <div style={{ marginTop: '20px' }}>
              {metadata.imageUrl ? (
                <div className="cover-image" style={{ marginBottom: '20px' }}>
                  <img src={metadata.imageUrl} alt="Story cover" style={{ width: '100%', maxWidth: '500px', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }} />
                </div>
              ) : (
                <div className="placeholder" style={{ padding: '20px', backgroundColor: '#f0f0f0', borderRadius: '10px', marginBottom: '20px' }}>Generating cover image...</div>
              )}

              {metadata.audioUrl ? (
                <div className="audio-player" style={{ marginBottom: '20px' }}>
                  <audio controls src={metadata.audioUrl} style={{ width: '100%', maxWidth: '500px' }}></audio>
                </div>
              ) : (
                <div className="placeholder" style={{ padding: '20px', backgroundColor: '#f0f0f0', borderRadius: '10px', marginBottom: '20px' }}>Generating audio...</div>
              )}

              {metadata.storyText ? (
                <div className="story-text" style={{ marginBottom: '20px', textAlign: 'left', maxWidth: '800px', margin: '0 auto' }}>
                  <details open style={{ width: '100%' }}>
                    <summary style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', cursor: 'pointer', padding: '10px 0' }}>Read the story</summary>
                    <p style={{ fontSize: '18px', color: '#666', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{metadata.storyText}</p>
                  </details>
                </div>
              ) : (
                <div className="placeholder" style={{ padding: '20px', backgroundColor: '#f0f0f0', borderRadius: '10px', marginBottom: '20px' }}>Generating story text...</div>
              )}
            </div>
          ) : (
            <div className="spinner" style={{ borderTopColor: '#ff6b6b', margin: '20px auto' }}></div>
          )}

          {metadata && metadata.status === 'complete' && metadata.audioStatus === 'complete' && metadata.imageStatus === 'complete' && (
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
          )}
        </div>
      )}
      
      {error && (
        <div style={{
          padding: '15px',
          backgroundColor: '#ffebee',
          color: '#c62828',
          borderRadius: '5px',
          marginBottom: '20px',
          fontWeight: 'bold',
          border: '1px solid #ef9a9a'
        }}>
          Error: {error}
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>{JSON.stringify(metadata, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default StoryMaker;
