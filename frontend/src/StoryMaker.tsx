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
      return s3Url; // Return original URL on error
    }
  };

  const pollMetadata = async (storyId: string) => {
    let attempts = 0;
    const maxAttempts = 60; // 10 minutes at 10 second intervals
    
    console.log(`Starting to poll metadata for story ID: ${storyId}`);
    
    const interval = setInterval(async () => {
      try {
        console.log(`Polling attempt ${attempts + 1} for story ID: ${storyId}`);
        const response = await api.get(`/metadata/${storyId}`);
        const data = response.data;
        console.log('Received metadata:', JSON.stringify(data, null, 2));
        
        // Process S3 URLs for audio and image if available
        const processedData: StoryMetadata = { ...data };
        
        // Fetch story text if available
        if (data.textUrl) {
          console.log(`Fetching story text from: ${data.textUrl}`);
          const storyText = await fetchStoryText(data.textUrl);
          if (storyText) {
            processedData.storyText = storyText;
          }
        }
        
        // Extract bucket name from textUrl if available
        let bucketName = '';
        if (data.textUrl && data.textUrl.startsWith('s3://')) {
          const textUrlParts = data.textUrl.replace('s3://', '').split('/');
          bucketName = textUrlParts[0];
          console.log(`Extracted bucket name: ${bucketName} from textUrl: ${data.textUrl}`);
        } else {
          console.warn('No textUrl found or textUrl does not start with s3://');
        }
        
        // Get presigned URLs for audio when status is complete
        if (data.audioStatus === 'complete') {
          console.log(`Audio status is complete for story ID: ${storyId}`);
          if (bucketName) {
            // Construct the audio URL using the known pattern
            const audioUrl = `s3://${bucketName}/stories/${storyId}/audio.mp3`;
            console.log('Constructed audio URL:', audioUrl);
            try {
              console.log('Getting presigned URL for audio...');
              const presignedAudioUrl = await getPresignedUrl(audioUrl);
              console.log('Received presigned audio URL:', presignedAudioUrl);
              processedData.audioUrl = presignedAudioUrl;
            } catch (e) {
              console.error('Error getting presigned audio URL:', e);
            }
          } else {
            console.error('Cannot construct audio URL: bucket name is empty');
          }
        } else {
          console.log(`Audio status is not complete: ${data.audioStatus}`);
        }
        
        // Get presigned URLs for image when status is complete
        if (data.imageStatus === 'complete') {
          console.log(`Image status is complete for story ID: ${storyId}`);
          if (bucketName) {
            // Construct the image URL using the known pattern
            const imageUrl = `s3://${bucketName}/stories/${storyId}/cover.png`;
            console.log('Constructed image URL:', imageUrl);
            try {
              console.log('Getting presigned URL for image...');
              const presignedImageUrl = await getPresignedUrl(imageUrl);
              console.log('Received presigned image URL:', presignedImageUrl);
              processedData.imageUrl = presignedImageUrl;
            } catch (e) {
              console.error('Error getting presigned image URL:', e);
            }
          } else {
            console.error('Cannot construct image URL: bucket name is empty');
          }
        } else {
          console.log(`Image status is not complete: ${data.imageStatus}`);
        }
        
        // Update metadata state
        setMetadata(processedData);
        
        // Check if story generation is complete
        if (data.status === 'complete' && 
            data.audioStatus === 'complete' && 
            data.imageStatus === 'complete') {
          clearInterval(interval);
          setIsGenerating(false);
        }
        
        attempts++;
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setIsGenerating(false);
          setError('Story generation timed out');
        }
      } catch (err) {
        console.error('Error polling metadata:', err);
        clearInterval(interval);
        setIsGenerating(false);
        setError('Error fetching story status');
      }
    }, 3000); // Poll every 3 seconds
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
