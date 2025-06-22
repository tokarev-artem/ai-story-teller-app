// Copied main app logic from src/frontend/App.tsx so CRA can import within src directory
import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import './BedtimeApp.css';
// import StoryList from './StoryList';

interface FormData {
  childName: string;
  childAge: string;
  theme: string;
  storyLength: string;
}



interface StoryMetadata {
  id: string;
  title: string;
  storyText: string;
  userId: string;
  audioUrl?: string;
  imageUrl?: string;
  imageStatus?: 'pending' | 'complete' | 'error';
  audioStatus?: 'pending' | 'complete' | 'error';
}

const API_ENDPOINTS = {
  STORY_GENERATOR: process.env.REACT_APP_STORY_GENERATOR_URL!,
  IMAGE_GENERATOR: process.env.REACT_APP_IMAGE_GENERATOR_URL!,
  PRESIGNED_URL: process.env.REACT_APP_PRESIGNED_URL!,
  STORY_METADATA: process.env.REACT_APP_STORY_METADATA_URL!,
};

const BedtimeApp: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    childName: '',
    childAge: '5',
    theme: 'adventure',
    storyLength: 'medium',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [polling, setPolling] = useState(false);
  const [storyId, setStoryId] = useState('');
  const [storyText, setStoryText] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);


  const userId = 'user-123';

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };



  useEffect(() => {
    if (!storyId || !polling) return;

    console.log(`Starting to poll for storyId: ${storyId}`);
    const interval = setInterval(async () => {
      try {
        const metaRes = await fetch(`${API_ENDPOINTS.STORY_METADATA}/${storyId}`);
        if (!metaRes.ok) {
          console.warn(`Polling: Metadata not ready yet (status: ${metaRes.status}). Retrying...`);
          return; // Keep polling
        }

        const metadata = (await metaRes.json()) as StoryMetadata;
        console.log('Polling: Got metadata:', metadata);

        const { imageStatus, audioStatus } = metadata;
        console.log(`Polling status: image[${imageStatus}] audio[${audioStatus}]`);

        // Check for errors first
        if (imageStatus === 'error' || audioStatus === 'error') {
          console.error('Polling failed: one of the generation processes resulted in an error.');
          setError('Sorry, something went wrong while creating your story. Please try again.');
          setPolling(false);
          setLoading(false);
          clearInterval(interval);
          return;
        }

        // Update story content as soon as it's available
        if (metadata.storyText && metadata.title) {
          setStoryText(metadata.storyText);
          setStoryTitle(metadata.title);
          setLoading(false);
        }

        // Update image and audio URLs if available
        if (metadata.imageUrl && imageStatus === 'complete') {
          setImageUrl(metadata.imageUrl);
        }
        if (metadata.audioUrl && audioStatus === 'complete') {
          setAudioUrl(metadata.audioUrl);
        }

        // Check if both are complete to stop polling
        if (imageStatus === 'complete' && audioStatus === 'complete') {
          console.log('Polling successful: Image and audio are ready.');
          setPolling(false);
          clearInterval(interval);
        } else {
          console.log('Still waiting for media files...');
        }
      } catch (err: any) {
        console.error('Error during polling:', err);
        setError('An error occurred while fetching the story. Please try again.');
        setPolling(false);
        setLoading(false);
        clearInterval(interval);
      }
    }, 5000); // Poll every 5 seconds

    // Add a timeout to stop polling after a reasonable time (e.g., 5 minutes)
    const timeout = setTimeout(() => {
      console.log('Polling timeout reached. Stopping polling.');
      setPolling(false);
      setLoading(false);
      setError('Story generation is taking too long. Please try again later.');
      clearInterval(interval);
    }, 300000); // 5 minutes timeout

    // Cleanup function to clear interval and timeout if component unmounts
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [storyId, polling]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setStoryId('');
    setStoryText('');
    setImageUrl(null);
    setAudioUrl('');

    try {
      console.log('Initiating story generation with data:', { ...formData, userId });
      const storyResponse = await fetch(API_ENDPOINTS.STORY_GENERATOR, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, userId, childAge: parseInt(formData.childAge) }),
      });

      if (storyResponse.status !== 202) {
        const errorBody = await storyResponse.text();
        throw new Error(`Failed to initiate story generation. Status: ${storyResponse.status}, Body: ${errorBody}`);
      }

      const responseData = await storyResponse.json();
      console.log('Story initiation successful:', responseData);
      setStoryId(responseData.storyId);
      setPolling(true); // Start polling

    } catch (err: any) {
      console.error('An error occurred in handleSubmit:', err);
      setError(err.message || 'Failed to start story generation.');
      setLoading(false);
    }
  };



  return (
    <div className="app-container" style={{
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      minHeight: '100vh',
      padding: '20px'
    }}>
      {loading && (
      <div style={{
      textAlign: 'center',
      marginTop: '20px',
      fontSize: '1.5rem',
      color: '#8a4fff',
      fontWeight: 'bold'
      }}>
      Generating your magical story... Please wait!
        <button 
            onClick={() => {
          setLoading(false);
          setPolling(false);
        }}
        style={{
          marginTop: '10px',
          backgroundColor: '#ff6347',
          color: 'white',
          border: 'none',
          padding: '8px 16px',
          borderRadius: '5px',
          cursor: 'pointer'
        }}
      >
        Cancel
      </button>
    </div>
  )}
      <header style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 style={{ 
          color: '#3a4a6d', 
          fontSize: '2.5rem',
          fontFamily: '"Comic Sans MS", cursive, sans-serif',
          textShadow: '2px 2px 4px rgba(0,0,0,0.1)'
        }}>
          ✨ Magic Story Maker ✨
        </h1>
        <p style={{ 
          color: '#5a6a8a', 
          fontSize: '1.2rem',
          fontFamily: '"Comic Sans MS", cursive, sans-serif'
        }}>
          Create your very own bedtime story!
        </p>
      </header>
      
      <main style={{ 
        maxWidth: '600px', 
        margin: '0 auto',
        backgroundColor: 'white',
        padding: '25px',
        borderRadius: '15px',
        boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
      }}>
        {(!storyId || loading) ? (
        <form onSubmit={handleSubmit} className="story-form">
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label htmlFor="childName" style={{
                display: 'block',
                marginBottom: '8px',
                color: '#3a4a6d',
                fontSize: '1.1rem',
                fontWeight: 'bold'
              }}>
                Story about
              </label>
              <input
                type="text"
                id="childName"
                name="childName"
                value={formData.childName}
                onChange={handleInputChange}
                required
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '2px solid #c3cfe2',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label htmlFor="childAge" style={{
                display: 'block',
                marginBottom: '8px',
                color: '#3a4a6d',
                fontSize: '1.1rem',
                fontWeight: 'bold'
              }}>
                How old is the main person?
              </label>
              <input
                type="number"
                id="childAge"
                name="childAge"
                min="1"
                max="12"
                value={formData.childAge}
                onChange={handleInputChange}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '2px solid #c3cfe2',
                  fontSize: '1rem'
                }}
              />
            </div>
            
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label htmlFor="theme" style={{
                display: 'block',
                marginBottom: '8px',
                color: '#3a4a6d',
                fontSize: '1.1rem',
                fontWeight: 'bold'
              }}>
                Theme of the story
              </label>
              <select
                id="theme"
                name="theme"
                value={formData.theme}
                onChange={handleInputChange}
                required
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '2px solid #c3cfe2',
                  fontSize: '1rem'
                }}
              >
                <option value="adventure">Adventure</option>
                <option value="fantasy">Fantasy</option>
                <option value="animals">Animals</option>
                <option value="space">Space</option>
                <option value="fairytale">Fairytale</option>
              </select>
            </div>
            
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label htmlFor="storyLength" style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontSize: '1.1rem',
                fontWeight: 'bold'
              }}>
                How long should the story be?
              </label>
              <select
                id="storyLength"
                name="storyLength"
                value={formData.storyLength}
                onChange={handleInputChange}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '2px solid #c3cfe2',
                  fontSize: '1rem'
                }}
              >
                <option value="short">Short (1-2 minutes)</option>
                <option value="medium">Medium (3-5 minutes)</option>
                <option value="long">Long (5+ minutes)</option>
              </select>
            </div>
            
            <button 
              type="submit" 
              disabled={loading}
              style={{
                backgroundColor: '#ff9f4d',
                color: 'white',
                border: 'none',
                padding: '12px 20px',
                borderRadius: '8px',
                fontSize: '1.1rem',
                cursor: 'pointer',
                width: '100%',
                marginTop: '15px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                transition: 'all 0.3s ease'
              }}
            >
              {loading ? '✨ Creating Your Story... ✨' : '🌟 Make My Story! 🌟'}
            </button>
          </form>
        ) : (
          <div className="story-display" style={{ 
            backgroundColor: '#f9f5ff',
            padding: '20px',
            borderRadius: '10px',
            borderLeft: '5px solid #8a4fff'
          }}>
            <h2 style={{ 
              color: '#3a4a6d',
              fontFamily: '"Comic Sans MS", cursive, sans-serif',
              marginBottom: '15px'
            }}>
              {storyTitle}
            </h2>
            <p style={{
              fontSize: '1.1rem',
              lineHeight: '1.6',
              color: '#333',
              whiteSpace: 'pre-line'
            }}>
              {storyText}
            </p>
            
            {imageUrl && (
              <div className="image-container">
                <img src={imageUrl} alt="Story illustration" />
              </div>
            )}
            
            {audioUrl && (
              <div style={{ margin: '20px 0' }}>
                <audio 
                  controls 
                  src={audioUrl}
                  style={{
                    width: '100%',
                    borderRadius: '8px'
                  }}
                ></audio>
              </div>
            )}
            
            <button 
              onClick={() => { 
                setStoryId(''); 
                setStoryText(''); 
                setStoryTitle(''); 
                setAudioUrl(''); 
                setImageUrl(null); 
              }}
              style={{
                backgroundColor: '#8a4fff',
                color: 'white',
                border: 'none',
                padding: '10px 15px',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                marginTop: '15px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              🎭 Create Another Story!
            </button>
          </div>
        )}
      </main>
      
      {error && (
        <div className="error-message" style={{
          color: '#ff4d4d',
          textAlign: 'center',
          marginTop: '20px',
          fontWeight: 'bold'
        }}>
          {error}
        </div>
      )}

      {/* <StoryList stories={stories} loading={storyListLoading} onSelectStory={handleStorySelect} />
      {audioUrl && <audio src={audioUrl} autoPlay onEnded={() => setAudioUrl('')} style={{ display: 'none' }} />} */}
    </div>
  );
};

export default BedtimeApp;
