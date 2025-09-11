// src/pages/ConsistencyPage.jsx
import React from 'react';
import { useParams } from 'react-router-dom';
import ConsistencyGraph from '../components/ConsistencyGraph';

export default function ConsistencyPage() {
  const { userId } = useParams();
  return <ConsistencyGraph userId={userId} days={30} movingAvg={3} includeExcusedAsDone={true} />;
}
