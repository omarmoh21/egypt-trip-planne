import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Mapbox access token - Get your free token from https://account.mapbox.com/access-tokens/
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw';

// Set the access token
mapboxgl.accessToken = MAPBOX_TOKEN;

const MapboxItineraryMap = ({ days, selectedDay = null, height = '500px', onDestinationClick }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markersRef = useRef([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mapError, setMapError] = useState(null);

  // Egyptian destination coordinates
  const getCoordinatesForDestination = (destinationName, region) => {
    const destinationCoordinates = {
      // Cairo & Giza
      'Pyramids of Giza': [31.1325, 29.9773],
      'Sphinx of Giza': [31.1376, 29.9753],
      'Egyptian Museum': [31.2336, 30.0478],
      'Khan El Khalili Bazaar': [31.2629, 30.0472],
      'Citadel of Saladin': [31.2602, 30.0287],
      'Coptic Cairo': [31.2306, 30.0051],
      'Cairo Tower': [31.2243, 30.0459],
      
      // Luxor
      'Luxor Temple': [32.6391, 25.6995],
      'Karnak Temple': [32.6573, 25.7188],
      'Valley of the Kings': [32.6014, 25.7402],
      'Valley of the Queens': [32.5918, 25.7284],
      'Temple of Hatshepsut': [32.6065, 25.7379],
      
      // Aswan
      'Abu Simbel': [31.6258, 22.3372],
      'Philae Temple': [32.8848, 24.0267],
      'Aswan High Dam': [32.8770, 23.9707],
      'Nubian Village': [32.8998, 24.0889],
      
      // Alexandria
      'Library of Alexandria': [29.9097, 31.2084],
      'Citadel of Qaitbay': [29.8850, 31.2139],
      'Pompey\'s Pillar': [29.8951, 31.1816],
      
      // Red Sea
      'Hurghada': [33.8117, 27.2578],
      'Sharm El Sheikh': [34.3300, 27.9158],
      'Dahab': [34.5136, 28.4951]
    };

    // Try exact match first
    if (destinationCoordinates[destinationName]) {
      return destinationCoordinates[destinationName];
    }

    // Try partial match
    const partialMatch = Object.keys(destinationCoordinates).find(key => 
      key.toLowerCase().includes(destinationName.toLowerCase()) ||
      destinationName.toLowerCase().includes(key.toLowerCase())
    );
    
    if (partialMatch) {
      return destinationCoordinates[partialMatch];
    }

    // Default coordinates based on region
    const regionDefaults = {
      'Cairo': [31.2357, 30.0444],
      'Giza': [31.1325, 29.9773],
      'Luxor': [32.6396, 25.6872],
      'Aswan': [32.8998, 24.0889],
      'Alexandria': [29.9187, 31.2001],
      'Red Sea': [33.8117, 27.2578]
    };

    return regionDefaults[region] || [30.8025, 26.8206]; // Center of Egypt
  };

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current) return;

    try {
      setIsLoading(true);
      
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/streets-v12', // You can change this style
        center: [30.8025, 26.8206], // Center of Egypt
        zoom: 5.5
      });

      map.current.on('load', () => {
        setIsLoading(false);
      });

      map.current.on('error', (e) => {
        console.error('Mapbox error:', e);
        setMapError('Failed to load map');
        setIsLoading(false);
      });

      // Cleanup
      return () => {
        if (map.current) {
          map.current.remove();
        }
      };
    } catch (error) {
      console.error('Error initializing Mapbox:', error);
      setMapError('Failed to initialize map');
      setIsLoading(false);
    }
  }, []);

  // Clear existing markers
  const clearMarkers = () => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  };

  // Create custom marker element
  const createCustomMarker = (dayNumber, color = '#D4AF37') => {
    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.style.cssText = `
      background: linear-gradient(135deg, ${color}, #B8860B);
      color: white;
      border-radius: 50%;
      width: 35px;
      height: 35px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
      border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
    `;
    el.textContent = dayNumber;
    return el;
  };

  // Update map with itinerary data
  useEffect(() => {
    if (!map.current || !days) return;

    clearMarkers();

    try {
      const bounds = new mapboxgl.LngLatBounds();
      const dayColors = [
        '#D4AF37', '#1E40AF', '#DC2626', '#059669', '#7C3AED',
        '#EA580C', '#DB2777', '#0891B2'
      ];

      Object.entries(days).forEach(([dayId, activities], dayIndex) => {
        if (!activities || activities.length === 0) return;

        const dayNumber = parseInt(dayId.split('-')[1]);
        const dayColor = dayColors[dayIndex % dayColors.length];

        activities.forEach((activity, activityIndex) => {
          if (!activity.location) return;

          const coords = getCoordinatesForDestination(activity.location, activity.region || '');
          if (!coords) return;

          // Create marker
          const markerElement = createCustomMarker(dayNumber, dayColor);
          
          const marker = new mapboxgl.Marker(markerElement)
            .setLngLat(coords)
            .addTo(map.current);

          // Create popup
          const popupContent = `
            <div style="min-width: 200px; padding: 8px;">
              <h3 style="margin: 0 0 8px 0; color: ${dayColor}; font-size: 16px; font-weight: bold;">
                Day ${dayNumber}: ${activity.title}
              </h3>
              <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">
                ${activity.time || 'Time not set'} • ${activity.location}
              </p>
              <p style="margin: 0; color: #374151; font-size: 13px;">
                ${activity.description || 'No description available'}
              </p>
            </div>
          `;

          const popup = new mapboxgl.Popup({ offset: 25 })
            .setHTML(popupContent);

          marker.setPopup(popup);

          // Add click handler
          if (onDestinationClick) {
            markerElement.addEventListener('click', () => {
              onDestinationClick(activity, dayId);
            });
          }

          markersRef.current.push(marker);
          bounds.extend(coords);
        });
      });

      // Fit map to show all markers
      if (!bounds.isEmpty()) {
        map.current.fitBounds(bounds, {
          padding: { top: 50, bottom: 50, left: 50, right: 50 }
        });
      }

    } catch (error) {
      console.error('Error updating Mapbox map:', error);
      setMapError('Failed to update map with itinerary data');
    }
  }, [days, selectedDay, onDestinationClick]);

  if (mapError) {
    return (
      <div 
        style={{ height }}
        className="flex items-center justify-center bg-gray-100 rounded-lg border-2 border-dashed border-gray-300"
      >
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <p className="text-gray-600 font-medium">{mapError}</p>
          <p className="text-sm text-gray-500 mt-2">Please check your internet connection</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {isLoading && (
        <div 
          style={{ height }}
          className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg z-10"
        >
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-pharaoh-gold border-t-transparent mb-4"></div>
            <p className="text-gray-600 font-medium">Loading Mapbox...</p>
          </div>
        </div>
      )}
      <div 
        ref={mapContainer}
        style={{ height, width: '100%' }}
        className="rounded-lg border border-gray-200 shadow-md"
      />
    </div>
  );
};

export default MapboxItineraryMap;
