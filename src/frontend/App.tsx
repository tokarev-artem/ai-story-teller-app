import React, { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import './App.css';

// Define interfaces for our data types
interface FormData {
  childName: string;
  childAge: string;
  theme: string;
  storyLength: string;
}

interface StoryData {
  id: string;
  title: string;
  text: string;
  userId: string;
  audioUrl?: string;
  imageUrl?: string;
}

interface UrlResponse {
  url: string;
  expires: string;
}

interface StoryMetadata {
  id: string;
  title: string;
  storyText: string;
  userId: string;
  audioUrl?: string;
  imageUrl?: string;
}

// API endpoints will be replaced with actual deployed endpoints
const API_ENDPOINTS = {
  STORY_GENERATOR: 'https://your-api-gateway-url/prod/generate-story',
  IMAGE_GENERATOR: 'https://your-api-gateway-url/prod/generate-image',
  PRESIGNED_URL: 'https://your-api-gateway-url/prod/presigned-url',
  STORY_METADATA: 'https://your-api-gateway-url/prod/stories',
};

const App: React.FC = () => {
  const [formData, setFormData] = useState<FormData>({
    childName: '',
    childAge: '5',
    theme: 'adventure',
    storyLength: 'medium',
  });
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [storyId, setStoryId] = useState<string>('');
  const [storyText, setStoryText] = useState<string>('');
  const [storyTitle, setStoryTitle] = useState<string>('');
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string>('');
  
  // Mock user ID for demo purposes
  const userId = 'user-123';

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: FormData) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      // Step 1: Generate story and audio
      const storyResponse = await fetch(API_ENDPOINTS.STORY_GENERATOR, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          childName: formData.childName,
          childAge: parseInt(formData.childAge),
          theme: formData.theme,
          storyLength: formData.storyLength,
          userId,
        }),
      });
      
      if (!storyResponse.ok) {
        throw new Error('Failed to generate story');
      }
      
      const storyData = await storyResponse.json() as StoryData;
      setStoryId(storyData.id);
      
      // Step 2: Get presigned URL for audio
      const audioUrlResponse = await fetch(API_ENDPOINTS.PRESIGNED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: `stories/${storyData.id}/audio.mp3`,
          operation: 'get',
        }),
      });
      
      if (!audioUrlResponse.ok) {
        throw new Error('Failed to get audio URL');
      }
      
      const audioUrlData = await audioUrlResponse.json() as UrlResponse;
      setAudioUrl(audioUrlData.url);
      
      // Step 3: Generate image
      const imageResponse = await fetch(API_ENDPOINTS.IMAGE_GENERATOR, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storyId: storyData.id,
        }),
      });
      
      if (!imageResponse.ok) {
        throw new Error('Failed to generate image');
      }
      
      // Step 4: Get story metadata including image URL
      const metadataResponse = await fetch(`${API_ENDPOINTS.STORY_METADATA}/${storyData.id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!metadataResponse.ok) {
        throw new Error('Failed to get story metadata');
      }
      
      const metadata = await metadataResponse.json() as StoryMetadata;
      setStoryText(metadata.storyText);
      setStoryTitle(metadata.title);
      
      // Step 5: Get presigned URL for image
      const imageUrlResponse = await fetch(API_ENDPOINTS.PRESIGNED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: `stories/${storyData.id}/cover.png`,
          operation: 'get',
        }),
      });
      
      if (!imageUrlResponse.ok) {
        throw new Error('Failed to get image URL');
      }
      
      const imageUrlData = await imageUrlResponse.json() as UrlResponse;
      setImageUrl(imageUrlData.url);
      
    } catch (err: any) {
      setError(`Error: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Bedtime Story Generator</h1>
        <p>Create personalized bedtime stories with AI</p>
      </header>
      
      <main>
        {!storyId ? (
          <form onSubmit={handleSubmit} className="story-form">
            <div className="form-group">
              <label htmlFor="childName">Child's Name</label>
              <input
                type="text"
                id="childName"
                name="childName"
                value={formData.childName}
                onChange={handleInputChange}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="childAge">Child's Age</label>
              <select
                id="childAge"
                name="childAge"
                value={formData.childAge}
                onChange={handleInputChange}
              >
                {[3, 4, 5, 6, 7, 8, 9, 10].map(age => (
                  <option key={age} value={age}>{age}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="theme">Story Theme</label>
              <select
                id="theme"
                name="theme"
                value={formData.theme}
                onChange={handleInputChange}
              >
                <option value="adventure">Adventure</option>
                <option value="fantasy">Fantasy</option>
                <option value="animals">Animals</option>
                <option value="space">Space</option>
                <option value="ocean">Ocean</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="storyLength">Story Length</label>
              <select
                id="storyLength"
                name="storyLength"
                value={formData.storyLength}
                onChange={handleInputChange}
              >
                <option value="short">Short (2-3 minutes)</option>
                <option value="medium">Medium (4-5 minutes)</option>
                <option value="long">Long (6-8 minutes)</option>
              </select>
            </div>
            
            <button type="submit" disabled={loading}>
              {loading ? 'Creating Story...' : 'Create Story'}
            </button>
          </form>
        ) : (
          <div className="story-display">
            <div className="story-header">
              <h2>{storyTitle}</h2>
              <button onClick={() => {
                setStoryId('');
                setStoryText('');
                setStoryTitle('');
                setAudioUrl('');
                setImageUrl('');
              }}>Create New Story</button>
            </div>
            
            <div className="story-content">
              {imageUrl && (
                <div className="story-image">
                  <img src={imageUrl} alt="Story cover" />
                </div>
              )}
              
              <div className="story-text">
                <p>{storyText}</p>
              </div>
              
              {audioUrl && (
                <div className="story-audio">
                  <h3>Listen to the story:</h3>
                  <audio controls src={audioUrl}>
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      
      {error && <div className="error-message">{error}</div>}
      
      <footer>
        <p>&copy; {new Date().getFullYear()} Bedtime Story Generator | Powered by AWS Bedrock</p>
      </footer>
    </div>
  );
};

export default App;
