
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface WaveformProps {
  blob: Blob | null;
  color?: string;
}

const Waveform: React.FC<WaveformProps> = ({ blob, color = '#6366f1' }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!blob || !containerRef.current) return;

    const generateWaveform = async () => {
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0); // Take first channel
      const samples = 100; // Number of bars
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }

      // Normalize data
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      const normalizedData = filteredData.map(n => n * multiplier);

      // Clear previous
      d3.select(containerRef.current).selectAll("*").remove();

      const width = containerRef.current!.clientWidth;
      const height = 64;

      const svg = d3.select(containerRef.current)
        .append("svg")
        .attr("width", width)
        .attr("height", height);

      const x = d3.scaleLinear().domain([0, samples]).range([0, width]);
      
      svg.selectAll("rect")
        .data(normalizedData)
        .enter()
        .append("rect")
        .attr("x", (d, i) => x(i))
        .attr("y", d => (height - (d * height)) / 2)
        .attr("width", (width / samples) * 0.7)
        .attr("height", d => Math.max(2, d * height))
        .attr("fill", color)
        .attr("rx", 2);
    };

    generateWaveform();
  }, [blob, color]);

  if (!blob) return <div className="h-16 w-full bg-white/5 rounded flex items-center justify-center text-xs text-white/20">No Audio Data</div>;

  return <div ref={containerRef} className="w-full h-16" />;
};

export default Waveform;
