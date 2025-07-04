import {
  Site,
  Restaurant,
  generateEmbedding,
  getTopSimilarRecords,
  selectClosestSitePair,
  haversineDistance,
  getMidpoint,
  generateComprehensiveItinerary
} from './groqTripPlannerService.js';

// Get restaurants by distance and meal type
export const getRestaurantsByDistance = async (collection, city = null, budgetConstraint = null, mealType = null, limit = 10) => {
  let query = {};
  if (city) query.city = city;
  if (budgetConstraint !== null) query.average_budget_egp = { $lte: budgetConstraint };
  if (mealType) query.type = mealType;

  const restaurants = await collection.find(query).lean();
  return restaurants.filter(r => r.latitude && r.longitude).slice(0, limit);
};

// Get Day 1 sites (always Pyramids + Egyptian Museum)
const getDay1Sites = async (budget) => {
  console.log(`🏛️ Getting Day 1 mandatory sites: Pyramids + Egyptian Museum`);

  try {
    // Try to get actual sites from database
    const pyramids = await Site.findOne({
      $or: [
        { name: { $regex: /pyramid/i } },
        { name: { $regex: /giza/i } }
      ]
    }).lean();

    const museum = await Site.findOne({
      $or: [
        { name: { $regex: /egyptian museum/i } },
        { name: { $regex: /museum/i } }
      ]
    }).lean();

    const sites = [];

    // Add Pyramids (real or fallback)
    if (pyramids) {
      sites.push({
        ...pyramids,
        cost_egp: Math.min(pyramids.budget || 200, budget * 0.6)
      });
    } else {
      sites.push({
        name: 'Pyramids of Giza',
        city: 'Giza',
        governorate: 'Giza',
        description: 'The last surviving wonder of the ancient world, these magnificent pyramids have stood for over 4,500 years.',
        similarity_score: 1.0,
        activities: ['Exploring', 'Photography', 'Camel Riding'],
        opening_time: '08:00',
        closing_time: '17:00',
        average_time_spent_hours: 3,
        cost_egp: Math.min(200, budget * 0.6),
        latitude: 29.9792,
        longitude: 31.1342
      });
    }

    // Add Egyptian Museum (real or fallback)
    if (museum) {
      sites.push({
        ...museum,
        cost_egp: Math.min(museum.budget || 100, budget * 0.4)
      });
    } else {
      sites.push({
        name: 'Egyptian Museum',
        city: 'Cairo',
        governorate: 'Cairo',
        description: 'Home to the world\'s most extensive collection of ancient Egyptian artifacts, including treasures from Tutankhamun\'s tomb.',
        similarity_score: 1.0,
        activities: ['Museum Tour', 'Photography', 'Learning'],
        opening_time: '09:00',
        closing_time: '17:00',
        average_time_spent_hours: 2.5,
        cost_egp: Math.min(100, budget * 0.4),
        latitude: 30.0478,
        longitude: 31.2336
      });
    }

    console.log(`✅ Day 1 sites prepared: ${sites.map(s => s.name).join(' + ')}`);
    return sites;

  } catch (error) {
    console.error('Error getting Day 1 sites:', error);
    // Return fallback sites
    return [
      {
        name: 'Pyramids of Giza',
        city: 'Giza',
        governorate: 'Giza',
        description: 'The last surviving wonder of the ancient world.',
        similarity_score: 1.0,
        activities: ['Exploring', 'Photography'],
        opening_time: '08:00',
        closing_time: '17:00',
        average_time_spent_hours: 3,
        cost_egp: budget * 0.6,
        latitude: 29.9792,
        longitude: 31.1342
      },
      {
        name: 'Egyptian Museum',
        city: 'Cairo',
        governorate: 'Cairo',
        description: 'World\'s most extensive collection of ancient Egyptian artifacts.',
        similarity_score: 1.0,
        activities: ['Museum Tour', 'Learning'],
        opening_time: '09:00',
        closing_time: '17:00',
        average_time_spent_hours: 2.5,
        cost_egp: budget * 0.4,
        latitude: 30.0478,
        longitude: 31.2336
      }
    ];
  }
};

// Select sites by governorate to ensure they're in the same region (STRICT SINGLE LOCATION CONSTRAINT)
const selectSitesByGovernorate = (sites, usedSites = new Set()) => {
  console.log(`🗺️ STRICT: Grouping sites by governorate for same-day visits (Single Location Constraint)`);

  const availableSites = sites.filter(site => !usedSites.has(site.name));
  if (availableSites.length === 0) return [];

  // Group sites by governorate/city with strict location matching
  const sitesByLocation = {};
  availableSites.forEach(site => {
    // Use both governorate and city for more precise grouping
    const location = site.governorate || site.city || 'Unknown';
    const normalizedLocation = location.toLowerCase().trim();

    if (!sitesByLocation[normalizedLocation]) {
      sitesByLocation[normalizedLocation] = [];
    }
    sitesByLocation[normalizedLocation].push(site);
  });

  console.log(`📍 Sites grouped by location:`, Object.keys(sitesByLocation).map(loc =>
    `${loc}: ${sitesByLocation[loc].length} sites`
  ).join(', '));

  // STRICT CONSTRAINT: Only consider locations with multiple sites
  const validLocations = Object.keys(sitesByLocation).filter(loc =>
    sitesByLocation[loc].length >= 2
  );

  if (validLocations.length === 0) {
    console.log(`⚠️ STRICT CONSTRAINT VIOLATION: No location has 2+ sites. Selecting best sites from same location.`);

    // Find the location with the highest scoring single site and try to find another nearby
    const allLocationScores = Object.keys(sitesByLocation).map(loc => {
      const sites = sitesByLocation[loc];
      const bestScore = Math.max(...sites.map(s => s.similarity_score || 0));
      return { location: loc, score: bestScore, sites };
    });

    allLocationScores.sort((a, b) => b.score - a.score);
    const bestLocation = allLocationScores[0];

    if (bestLocation.sites.length === 1) {
      // Try to find another site in the same city/governorate
      const primarySite = bestLocation.sites[0];
      const sameCitySites = availableSites.filter(s =>
        s.city?.toLowerCase() === primarySite.city?.toLowerCase() ||
        s.governorate?.toLowerCase() === primarySite.governorate?.toLowerCase()
      );

      if (sameCitySites.length >= 2) {
        console.log(`✅ Found ${sameCitySites.length} sites in same city/governorate: ${primarySite.city || primarySite.governorate}`);
        return sameCitySites.slice(0, 2);
      }
    }

    return bestLocation.sites.slice(0, Math.min(2, bestLocation.sites.length));
  }

  // Find the location with the highest average similarity score
  let bestLocation = null;
  let bestScore = 0;

  validLocations.forEach(loc => {
    const locSites = sitesByLocation[loc];
    const avgScore = locSites.reduce((sum, site) => sum + (site.similarity_score || 0), 0) / locSites.length;
    if (avgScore > bestScore) {
      bestScore = avgScore;
      bestLocation = loc;
    }
  });

  if (!bestLocation) {
    console.log(`❌ CRITICAL: No valid location found with 2+ sites`);
    return [];
  }

  console.log(`🎯 STRICT: Selected location: ${bestLocation} (avg score: ${bestScore.toFixed(2)})`);

  // Return top 2 sites from the best location
  const selectedLocationSites = sitesByLocation[bestLocation]
    .sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0))
    .slice(0, 2);

  console.log(`✅ STRICT: Selected sites in same location: ${selectedLocationSites.map(s => `${s.name} (${s.city})`).join(', ')}`);
  return selectedLocationSites;
};

// Get fallback sites for when RAG fails
const getFallbackSites = async (dayNumber, budget) => {
  console.log(`🔄 Getting fallback sites for day ${dayNumber + 1}`);

  const fallbackSitesByDay = [
    // Day 2: Luxor sites
    [
      { name: 'Karnak Temple', city: 'Luxor', governorate: 'Luxor' },
      { name: 'Valley of the Kings', city: 'Luxor', governorate: 'Luxor' }
    ],
    // Day 3: Alexandria sites
    [
      { name: 'Bibliotheca Alexandrina', city: 'Alexandria', governorate: 'Alexandria' },
      { name: 'Citadel of Qaitbay', city: 'Alexandria', governorate: 'Alexandria' }
    ],
    // Day 4: Aswan sites
    [
      { name: 'Philae Temple', city: 'Aswan', governorate: 'Aswan' },
      { name: 'High Dam', city: 'Aswan', governorate: 'Aswan' }
    ],
    // Day 5+: Cairo sites
    [
      { name: 'Citadel of Saladin', city: 'Cairo', governorate: 'Cairo' },
      { name: 'Khan el-Khalili', city: 'Cairo', governorate: 'Cairo' }
    ]
  ];

  const dayIndex = Math.min(dayNumber - 1, fallbackSitesByDay.length - 1);
  const fallbackPair = fallbackSitesByDay[dayIndex];

  return fallbackPair.map((site, index) => ({
    ...site,
    description: `Historic site in ${site.city}`,
    similarity_score: 0.7,
    activities: ['Exploring', 'Photography'],
    opening_time: '08:00',
    closing_time: '17:00',
    average_time_spent_hours: 2.5,
    cost_egp: budget * (index === 0 ? 0.6 : 0.4),
    latitude: 30.0 + Math.random() * 2, // Approximate coordinates
    longitude: 31.0 + Math.random() * 2
  }));
};

// Build daily plan with RAG-based site selection
export const buildDailyPlan = async (userData, dayNumber, usedSites, assignedCity = null) => {
  console.log(`🏗️ Building daily plan for day ${dayNumber + 1}`);
  console.log(`Interests: ${userData.interests.join(', ')}`);

  // Use assigned city from optimized allocation
  const targetCity = assignedCity || (userData.cities ? userData.cities[0] : null);
  console.log(`🏙️ Assigned city for day ${dayNumber + 1}: ${targetCity || 'Any city'}`);

  const dailyBudget = userData.budget / userData.days;
  let sitesBudget = dailyBudget * 0.7;
  let foodBudget = dailyBudget * 0.3;

  console.log(`💰 Daily budget: ${dailyBudget} EGP (Initial - Sites: ${sitesBudget}, Food: ${foodBudget})`);

  let selectedSites = [];

  // Day 1: Always Pyramids + Egyptian Museum (but respect city constraint)
  if (dayNumber === 0) {
    console.log(`🏛️ Day 1: Setting up Pyramids + Egyptian Museum`);
    selectedSites = await getDay1Sites(sitesBudget);

    // Ensure Day 1 sites are in the assigned city if specified
    if (targetCity && targetCity.toLowerCase() !== 'cairo' && targetCity.toLowerCase() !== 'giza') {
      console.log(`⚠️ Day 1 assigned to ${targetCity}, but Pyramids are in Cairo/Giza. Adjusting...`);
      // For non-Cairo/Giza cities, use RAG to find appropriate sites
      const interestsText = userData.interests.join(' ');
      const userEmbedding = await generateEmbedding(interestsText);
      const sites = await getTopSimilarRecords(Site, userEmbedding, targetCity, 10, sitesBudget, userData.age);

      if (sites.length > 0) {
        selectedSites = selectSitesByGovernorate(sites, usedSites);
        console.log(`✅ Adjusted Day 1 sites for ${targetCity}: ${selectedSites.map(s => s.name).join(', ')}`);
      }
    } else {
      console.log(`✅ Day 1 sites selected: ${selectedSites.map(s => s.name).join(', ')}`);
    }
  } else {
    // Other days: Use RAG with governorate grouping
    console.log(`🔍 Day ${dayNumber + 1}: Using RAG with governorate grouping`);

    const interestsText = userData.interests.join(' ');
    console.log(`🔍 Generating embedding for: "${interestsText}"`);
    const userEmbedding = await generateEmbedding(interestsText);
    console.log(`📊 Generated embedding with ${userEmbedding.length} dimensions`);

    console.log(`🔍 Searching for sites with RAG...`);
    const sites = await getTopSimilarRecords(Site, userEmbedding, targetCity, 10, sitesBudget, userData.age);
    console.log(`📍 Found ${sites.length} sites from RAG search`);

    if (sites.length === 0) {
      console.log(`⚠️ No sites found for day ${dayNumber + 1} - creating fallback plan`);
      selectedSites = await getFallbackSites(dayNumber, sitesBudget);
    } else {
      selectedSites = selectSitesByGovernorate(sites, usedSites);
      console.log(`✅ Selected ${selectedSites.length} sites for day ${dayNumber + 1} in same governorate`);
    }
  }

  for (const site of selectedSites) {
    usedSites.add(site.name);
  }

  const formattedSites = selectedSites.map(site => ({
    name: site.name || 'Unknown Site',
    city: site.city || 'Cairo',
    description: site.description || 'No description available',
    similarity_score: site.similarity_score || 0.0,
    activities: site.activities || ['Exploring', 'Photography'],
    opening_time: site.opening_time || '08:00',
    closing_time: site.closing_time || '18:00',
    average_time_spent_hours: Number(site.average_time_spent_hours || 2.0),
    cost_egp: Number(site.cost_egp || site.budget || 0.0),
    latitude: site.latitude,
    longitude: site.longitude
  }));

  let distanceBetweenSites = 0.0;
  if (selectedSites.length === 2) {
    const coord1 = { latitude: selectedSites[0].latitude, longitude: selectedSites[0].longitude };
    const coord2 = { latitude: selectedSites[1].latitude, longitude: selectedSites[1].longitude };
    distanceBetweenSites = haversineDistance(coord1, coord2);
  }

  const restaurants = { breakfast: null, lunch: null, dinner: null };
  let dailyCost = formattedSites.reduce((sum, s) => sum + s.cost_egp, 0);

  console.log(`💰 Initial sites cost: ${dailyCost} EGP (Target daily budget: ${dailyBudget} EGP)`);

  if (selectedSites.length) {
    // CRITICAL: Ensure restaurants are in the same city as sites for single location constraint
    const siteCity = selectedSites[0].city;
    console.log(`🍽️ Finding restaurants in ${siteCity} for day ${dayNumber + 1} (Single Location Constraint)`);

    // Validate all sites are in the same city/governorate
    const siteCities = [...new Set(selectedSites.map(s => s.city))];
    if (siteCities.length > 1) {
      console.log(`⚠️ WARNING: Sites span multiple cities: ${siteCities.join(', ')}. Using primary city: ${siteCity}`);
    }

    // Get all unique restaurants to avoid duplicates
    const usedRestaurants = new Set();

    // BREAKFAST: Near the first site (user starts day here)
    console.log(`🌅 Finding breakfast restaurants near first site: ${selectedSites[0].name}`);
    const firstSiteCoord = { latitude: selectedSites[0].latitude, longitude: selectedSites[0].longitude };
    const breakfastRestaurants = await getRestaurantsByDistance(Restaurant, siteCity, foodBudget, 'breakfast', 20);
    console.log(`Found ${breakfastRestaurants.length} breakfast restaurants in ${siteCity}`);

    const breakfast = breakfastRestaurants.reduce((min, r) => {
      const dist = haversineDistance(firstSiteCoord, { latitude: r.latitude, longitude: r.longitude });
      return !min || dist < min.dist ? { ...r, dist } : min;
    }, null);

    if (breakfast) {
      restaurants.breakfast = {
        name: breakfast.name || 'Unknown Restaurant',
        city: breakfast.city || 'Cairo',
        description: breakfast.description || 'No description available',
        budget_egp: Number(breakfast.average_budget_egp || 0.0),
        opening_hours: breakfast.opening_hours || '08:00',
        closing_hours: breakfast.closing_hours || '16:00',
        distance_km: Math.round(breakfast.dist * 100) / 100
      };
      dailyCost += breakfast.average_budget_egp || 0.0;
      usedRestaurants.add(breakfast._id?.toString() || breakfast.name);
      console.log(`✅ Breakfast: ${breakfast.name} (${Math.round(breakfast.dist * 100) / 100} km from ${selectedSites[0].name})`);
    }

    // LUNCH: Near current location at lunch time (12:00-13:00)
    let lunch = null;
    let lunchLocation = firstSiteCoord; // Default to first site

    if (selectedSites.length === 2) {
      // If user has 2 sites, they'll likely be at the first site during lunch time
      // Or moving between sites, so we use the first site location
      lunchLocation = firstSiteCoord;
      console.log(`🍽️ Finding lunch restaurants near current location at 12:00 (${selectedSites[0].name})`);
    } else {
      console.log(`🍽️ Finding lunch restaurants near ${selectedSites[0].name}`);
    }

    const lunchRestaurants = await getRestaurantsByDistance(Restaurant, siteCity, foodBudget, 'lunch', 20);
    console.log(`Found ${lunchRestaurants.length} lunch restaurants in ${siteCity}`);

    const lunchCandidates = lunchRestaurants.filter(r => !usedRestaurants.has(r._id?.toString() || r.name));
    lunch = lunchCandidates.reduce((min, r) => {
      const dist = haversineDistance(lunchLocation, { latitude: r.latitude, longitude: r.longitude });
      return !min || dist < min.dist ? { ...r, dist } : min;
    }, null);

    if (lunch) {
      restaurants.lunch = {
        name: lunch.name || 'Unknown Restaurant',
        city: lunch.city || 'Cairo',
        description: lunch.description || 'No description available',
        budget_egp: Number(lunch.average_budget_egp || 0.0),
        opening_hours: lunch.opening_hours || '11:00',
        closing_hours: lunch.closing_hours || '20:00',
        distance_km: Math.round(lunch.dist * 100) / 100
      };
      dailyCost += lunch.average_budget_egp || 0.0;
      usedRestaurants.add(lunch._id?.toString() || lunch.name);
      console.log(`✅ Lunch: ${lunch.name} (${Math.round(lunch.dist * 100) / 100} km from current location)`);
    }

    // DINNER: Near the last site (where user ends the day)
    const lastSiteCoord = selectedSites.length === 2
      ? { latitude: selectedSites[1].latitude, longitude: selectedSites[1].longitude }
      : firstSiteCoord;
    const lastSiteName = selectedSites.length === 2 ? selectedSites[1].name : selectedSites[0].name;

    console.log(`🌆 Finding dinner restaurants near last site: ${lastSiteName}`);

    const dinnerRestaurants = await getRestaurantsByDistance(Restaurant, siteCity, foodBudget, 'dinner', 20);
    console.log(`Found ${dinnerRestaurants.length} dinner restaurants in ${siteCity}`);

    const dinnerCandidates = dinnerRestaurants.filter(r => !usedRestaurants.has(r._id?.toString() || r.name));
    const dinner = dinnerCandidates.reduce((min, r) => {
      const dist = haversineDistance(lastSiteCoord, { latitude: r.latitude, longitude: r.longitude });
      return !min || dist < min.dist ? { ...r, dist } : min;
    }, null);

    if (dinner) {
      restaurants.dinner = {
        name: dinner.name || 'Unknown Restaurant',
        city: dinner.city || 'Cairo',
        description: dinner.description || 'No description available',
        budget_egp: Number(dinner.average_budget_egp || 0.0),
        opening_hours: dinner.opening_hours || '14:00',
        closing_hours: dinner.closing_hours || '23:00',
        distance_km: Math.round(dinner.dist * 100) / 100
      };
      dailyCost += dinner.average_budget_egp || 0.0;
      console.log(`✅ Dinner: ${dinner.name} (${Math.round(dinner.dist * 100) / 100} km from ${lastSiteName})`);
    }
  }

  // 🎯 BUDGET OPTIMIZATION: Maximize daily budget utilization
  const budgetUtilization = dailyCost / dailyBudget;
  const remainingBudget = dailyBudget - dailyCost;

  console.log(`💰 Current cost: ${dailyCost} EGP / ${dailyBudget} EGP (${(budgetUtilization * 100).toFixed(1)}% utilized)`);
  console.log(`💰 Remaining budget: ${remainingBudget} EGP`);

  // If we're significantly under budget (less than 85% utilized), try to optimize
  if (budgetUtilization < 0.85 && remainingBudget > 100) {
    console.log(`🎯 BUDGET OPTIMIZATION: Under-utilizing budget, attempting to upgrade experiences...`);

    // Strategy 1: Upgrade restaurants to higher-end options
    if (selectedSites.length > 0 && remainingBudget > 200) {
      const siteCity = selectedSites[0].city;
      const upgradeAmount = Math.min(remainingBudget * 0.6, 500); // Use up to 60% of remaining budget or 500 EGP max

      console.log(`🍽️ Attempting to upgrade restaurants with ${upgradeAmount} EGP budget...`);

      // Try to upgrade dinner first (usually most expensive)
      if (restaurants.dinner && upgradeAmount > 100) {
        const premiumDinnerBudget = restaurants.dinner.budget_egp + upgradeAmount * 0.5;
        const premiumDinnerRestaurants = await getRestaurantsByDistance(Restaurant, siteCity, premiumDinnerBudget, 'dinner', 10);

        const lastSiteCoord = selectedSites.length === 2
          ? { latitude: selectedSites[1].latitude, longitude: selectedSites[1].longitude }
          : { latitude: selectedSites[0].latitude, longitude: selectedSites[0].longitude };

        const premiumDinner = premiumDinnerRestaurants
          .filter(r => r.average_budget_egp > restaurants.dinner.budget_egp)
          .reduce((best, r) => {
            const dist = haversineDistance(lastSiteCoord, { latitude: r.latitude, longitude: r.longitude });
            return !best || (r.average_budget_egp > best.average_budget_egp && dist < 5) ? { ...r, dist } : best;
          }, null);

        if (premiumDinner) {
          const costIncrease = premiumDinner.average_budget_egp - restaurants.dinner.budget_egp;
          dailyCost += costIncrease;
          restaurants.dinner = {
            name: premiumDinner.name || 'Premium Restaurant',
            city: premiumDinner.city || siteCity,
            description: premiumDinner.description || 'Premium dining experience',
            budget_egp: Number(premiumDinner.average_budget_egp),
            opening_hours: premiumDinner.opening_hours || '14:00',
            closing_hours: premiumDinner.closing_hours || '23:00',
            distance_km: Math.round(premiumDinner.dist * 100) / 100
          };
          console.log(`⬆️ UPGRADED Dinner: ${premiumDinner.name} (+${costIncrease} EGP)`);
        }
      }

      // Try to upgrade lunch if still have budget
      const newRemainingBudget = dailyBudget - dailyCost;
      if (restaurants.lunch && newRemainingBudget > 100) {
        const premiumLunchBudget = restaurants.lunch.budget_egp + newRemainingBudget * 0.4;
        const premiumLunchRestaurants = await getRestaurantsByDistance(Restaurant, siteCity, premiumLunchBudget, 'lunch', 10);

        const lunchLocation = selectedSites.length === 2
          ? getMidpoint(selectedSites[0], selectedSites[1])
          : { latitude: selectedSites[0].latitude, longitude: selectedSites[0].longitude };

        const premiumLunch = premiumLunchRestaurants
          .filter(r => r.average_budget_egp > restaurants.lunch.budget_egp)
          .reduce((best, r) => {
            const dist = haversineDistance(lunchLocation, { latitude: r.latitude, longitude: r.longitude });
            return !best || (r.average_budget_egp > best.average_budget_egp && dist < 5) ? { ...r, dist } : best;
          }, null);

        if (premiumLunch) {
          const costIncrease = premiumLunch.average_budget_egp - restaurants.lunch.budget_egp;
          dailyCost += costIncrease;
          restaurants.lunch = {
            name: premiumLunch.name || 'Premium Restaurant',
            city: premiumLunch.city || siteCity,
            description: premiumLunch.description || 'Premium dining experience',
            budget_egp: Number(premiumLunch.average_budget_egp),
            opening_hours: premiumLunch.opening_hours || '11:00',
            closing_hours: premiumLunch.closing_hours || '20:00',
            distance_km: Math.round(premiumLunch.dist * 100) / 100
          };
          console.log(`⬆️ UPGRADED Lunch: ${premiumLunch.name} (+${costIncrease} EGP)`);
        }
      }
    }

    // Strategy 2: Add premium experiences/activities to sites
    const finalRemainingBudget = dailyBudget - dailyCost;
    if (finalRemainingBudget > 150) {
      console.log(`🎭 Adding premium experiences with remaining ${finalRemainingBudget} EGP...`);

      // Add premium experiences to sites
      formattedSites.forEach((site, index) => {
        if (finalRemainingBudget > 100) {
          const premiumExperiencesCost = Math.min(finalRemainingBudget * 0.3, 200);
          site.cost_egp += premiumExperiencesCost;
          dailyCost += premiumExperiencesCost;

          // Add premium activities
          const premiumActivities = [
            'Private guided tour',
            'Professional photography session',
            'VIP access',
            'Audio guide rental',
            'Souvenir shopping'
          ];

          site.activities = [...(site.activities || []), ...premiumActivities.slice(0, 2)];
          console.log(`⭐ PREMIUM: Added ${premiumExperiencesCost} EGP premium experience to ${site.name}`);
        }
      });
    }
  }

  const finalBudgetUtilization = dailyCost / dailyBudget;
  console.log(`💰 FINAL: ${dailyCost} EGP / ${dailyBudget} EGP (${(finalBudgetUtilization * 100).toFixed(1)}% utilized)`);
  console.log(`💰 Final remaining: ${(dailyBudget - dailyCost).toFixed(0)} EGP`);

  // Generate comprehensive itinerary using AI
  let comprehensiveItinerary = null;
  try {
    console.log(`🤖 Generating AI-powered comprehensive itinerary for day ${dayNumber + 1}`);
    comprehensiveItinerary = await generateComprehensiveItinerary(
      formattedSites,
      restaurants,
      userData,
      dayNumber
    );
    console.log(`✅ Generated comprehensive itinerary for day ${dayNumber + 1}`);
  } catch (error) {
    console.error(`❌ Error generating comprehensive itinerary for day ${dayNumber + 1}:`, error.message);
  }

  return {
    day: dayNumber + 1,
    sites: formattedSites,
    distance_between_sites_km: Number(distanceBetweenSites),
    restaurants,
    daily_cost_egp: Number(dailyCost),
    comprehensive_itinerary: comprehensiveItinerary // Add the AI-generated comprehensive plan
  };
};

// Optimize city allocation for logical trip flow
const optimizeCityAllocation = (cities, totalDays) => {
  if (!cities || cities.length <= 1) {
    const allocation = Array(totalDays).fill(cities?.[0] || null);
    console.log(`🗺️ Single city trip: ${cities?.[0] || 'Any city'} for all ${totalDays} days`);
    return allocation;
  }

  console.log(`🗺️ OPTIMIZING LOGICAL TRIP FLOW:`);
  console.log(`   📊 ${totalDays} days across ${cities.length} cities: [${cities.join(', ')}]`);

  // Calculate days per city (distribute as evenly as possible)
  const baseDaysPerCity = Math.floor(totalDays / cities.length);
  const extraDays = totalDays % cities.length;

  console.log(`   📐 Base days per city: ${baseDaysPerCity}, Extra days to distribute: ${extraDays}`);

  const cityAllocation = [];
  let currentDay = 0;

  cities.forEach((city, index) => {
    // Some cities get an extra day if there are remainder days
    const daysForThisCity = baseDaysPerCity + (index < extraDays ? 1 : 0);
    console.log(`   🏙️ ${city}: ${daysForThisCity} consecutive days`);

    for (let i = 0; i < daysForThisCity; i++) {
      cityAllocation[currentDay] = city;
      currentDay++;
    }
  });

  console.log(`✅ OPTIMIZED ALLOCATION (Consecutive Grouping):`);
  console.log(`   ${cityAllocation.map((city, day) => `Day ${day + 1}: ${city}`).join(' | ')}`);

  // Show the logical flow benefit
  const consecutiveGroups = [];
  let currentGroup = { city: cityAllocation[0], start: 1, count: 1 };

  for (let i = 1; i < cityAllocation.length; i++) {
    if (cityAllocation[i] === currentGroup.city) {
      currentGroup.count++;
    } else {
      consecutiveGroups.push(`${currentGroup.city}: Days ${currentGroup.start}-${currentGroup.start + currentGroup.count - 1}`);
      currentGroup = { city: cityAllocation[i], start: i + 1, count: 1 };
    }
  }
  consecutiveGroups.push(`${currentGroup.city}: Days ${currentGroup.start}-${currentGroup.start + currentGroup.count - 1}`);

  console.log(`🎯 LOGICAL FLOW ACHIEVED: ${consecutiveGroups.join(' → ')}`);
  return cityAllocation;
};

// Build complete trip plan
export const buildTripPlan = async (userData) => {
  console.log('🚀 Starting trip plan generation...');
  console.log('User data:', userData);

  try {
    // Optimize city allocation for logical travel flow
    const cityAllocation = optimizeCityAllocation(userData.cities, userData.days);

    const tripPlan = {
      user_preferences: {
        age: userData.age,
        total_budget_egp: Number(userData.budget),
        daily_budget_egp: Number(userData.budget / userData.days),
        interests: userData.interests,
        duration_days: userData.days,
        city: userData.cities ? userData.cities[0] : 'Not specified (Nationwide)',
        city_allocation: cityAllocation // Add city allocation to user preferences
      },
      days: [],
      trip_summary: {
        total_trip_cost_egp: 0.0,
        remaining_budget_egp: 0.0
      }
    };

    const usedSites = new Set();
    console.log(`📅 Generating ${userData.days} days of itinerary...`);

    for (let day = 0; day < userData.days; day++) {
      console.log(`\n--- Day ${day + 1} ---`);
      try {
        // Pass the optimized city allocation to daily plan builder
        const dailyPlan = await buildDailyPlan(userData, day, usedSites, cityAllocation[day]);
        tripPlan.days.push(dailyPlan);
        console.log(`✅ Day ${day + 1} completed successfully`);
      } catch (dayError) {
        console.error(`❌ Error building day ${day + 1}:`, dayError.message);
        // Add a fallback day
        tripPlan.days.push({
          day: day + 1,
          sites: [],
          distance_between_sites_km: 0,
          restaurants: { breakfast: null, lunch: null, dinner: null },
          daily_cost_egp: 0
        });
      }
    }

    const totalCost = tripPlan.days.reduce((sum, day) => sum + day.daily_cost_egp, 0);
    tripPlan.trip_summary.total_trip_cost_egp = Number(totalCost);
    tripPlan.trip_summary.remaining_budget_egp = Number(userData.budget - totalCost);

    console.log('🎉 Trip plan generation completed!');
    console.log(`Total cost: ${totalCost} EGP`);
    console.log(`Days generated: ${tripPlan.days.length}`);

    return tripPlan;
  } catch (error) {
    console.error('❌ Critical error in buildTripPlan:', error);
    throw error;
  }
};

// Convert MongoDB trip plan to frontend format
export const convertTripPlanToFrontendFormat = (tripPlan) => {
  const suggestions = [];
  
  tripPlan.days.forEach((day, dayIndex) => {
    day.sites.forEach((site, siteIndex) => {
      suggestions.push({
        id: `mongo-site-${dayIndex}-${siteIndex}`,
        name: site.name,
        region: site.city,
        category: 'historical', // Default category
        shortDescription: site.description,
        coverImage: `/src/assets/destinations/${site.name.toLowerCase().replace(/\s+/g, '-')}.svg`,
        averageRating: Math.min(5, 3 + site.similarity_score * 2), // Convert similarity to rating
        reviewCount: Math.floor(Math.random() * 1000) + 100,
        entryFee: { adult: `${site.cost_egp} EGP` },
        visitDuration: `${site.average_time_spent_hours} hours`,
        reason: `Similarity score: ${site.similarity_score}`,
        priority: site.similarity_score > 0.7 ? 'high' : site.similarity_score > 0.4 ? 'medium' : 'low',
        mongoData: site // Keep original data for reference
      });
    });
  });

  return {
    destinations: suggestions,
    tripPlan: tripPlan,
    dailyPlans: tripPlan.days,
    totalEstimatedCost: tripPlan.trip_summary.total_trip_cost_egp,
    recommendations: [
      'Book popular attractions in advance',
      'Stay hydrated and wear sun protection',
      'Consider hiring local guides for historical sites'
    ]
  };
};
