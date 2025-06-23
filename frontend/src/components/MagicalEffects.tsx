import React, { useEffect } from 'react';
import styled, { keyframes } from 'styled-components';

// Star animations
const twinkle = keyframes`
  0% { opacity: 0.2; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0.2; transform: scale(0.8); }
`;

const Star = styled.div`
  position: absolute;
  background: white;
  border-radius: 50%;
  animation: ${twinkle} ${props => 2 + Math.random() * 3}s infinite;
  animation-delay: ${props => Math.random() * 2}s;
`;

const WizardCharacter = styled.div`
  position: absolute;
  right: 20px;
  bottom: 20px;
  width: 120px;
  height: 180px;
  background: url('wizard.png') no-repeat center center;
  background-size: contain;
  z-index: 10;
`;

export const FloatingStars = ({ count = 30 }) => {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Star 
          key={i}
          style={{
            width: `${3 + Math.random() * 4}px`,
            height: `${3 + Math.random() * 4}px`,
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
          }}
        />
      ))}
    </>
  );
};

export const CharacterIllustration = () => {
  return <WizardCharacter />;
};
