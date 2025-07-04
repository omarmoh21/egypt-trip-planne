import { buildTripPlan } from './services/tripBuilderService.js';
import { initializeGroqTripPlanner } from './services/groqTripPlannerService.js';

console.log('✅ Groq Trip Planner Service initialized');
console.log('🧪 Testing Optimized Trip Flow Logic...\n');

// Test Case 1: Multi-city trip with logical flow optimization
const testMultiCityFlow = async () => {
  console.log('=== TEST CASE 1: Multi-City Logical Flow ===');
  
  const testData = {
    age: 25,
    budget: 8000, // Higher budget for multi-city
    days: 5,
    interests: ['historical sites', 'food', 'culture'],
    cities: ['Cairo', 'Aswan', 'Alexandria'] // 3 cities, 5 days
  };

  console.log('Test data:', testData);
  console.log('\n--- Expected Optimized Flow ---');
  console.log('Days 1-2: Cairo (consecutive)');
  console.log('Days 3-4: Aswan (consecutive)'); 
  console.log('Day 5: Alexandria');
  console.log('\n--- Starting Trip Plan Generation ---\n');

  try {
    await initializeGroqTripPlanner();
    const result = await buildTripPlan(testData);
    
    console.log('\n--- CITY ALLOCATION RESULTS ---');
    if (!result.tripPlan || !result.tripPlan.days) {
      console.log('❌ ERROR: No trip plan or days found in result');
      return;
    }

    result.tripPlan.days.forEach((day, index) => {
      const dayCity = day.sites.length > 0 ? day.sites[0].city : 'No sites';
      console.log(`📍 Day ${index + 1}: ${dayCity}`);
      
      // Check single location constraint
      const uniqueCities = [...new Set(day.sites.map(s => s.city))];
      if (uniqueCities.length > 1) {
        console.log(`❌ VIOLATION: Day ${index + 1} has sites in multiple cities: ${uniqueCities.join(', ')}`);
      } else if (uniqueCities.length === 1) {
        console.log(`✅ GOOD: Day ${index + 1} all activities in ${uniqueCities[0]}`);
      }
      
      // Check restaurant location constraint
      const restaurants = day.restaurants;
      if (restaurants.breakfast || restaurants.lunch || restaurants.dinner) {
        const restaurantCities = [
          restaurants.breakfast?.city,
          restaurants.lunch?.city, 
          restaurants.dinner?.city
        ].filter(Boolean);
        
        const uniqueRestaurantCities = [...new Set(restaurantCities)];
        if (uniqueRestaurantCities.length > 1) {
          console.log(`❌ VIOLATION: Day ${index + 1} restaurants in multiple cities: ${uniqueRestaurantCities.join(', ')}`);
        } else if (uniqueRestaurantCities.length === 1 && uniqueCities.length === 1) {
          if (uniqueRestaurantCities[0] === uniqueCities[0]) {
            console.log(`✅ PERFECT: Day ${index + 1} sites and restaurants all in ${uniqueCities[0]}`);
          } else {
            console.log(`⚠️ MISMATCH: Day ${index + 1} sites in ${uniqueCities[0]} but restaurants in ${uniqueRestaurantCities[0]}`);
          }
        }
      }
    });
    
    // Analyze consecutive city grouping
    console.log('\n--- CONSECUTIVE GROUPING ANALYSIS ---');
    const citySequence = result.tripPlan.days.map(day => 
      day.sites.length > 0 ? day.sites[0].city : 'Unknown'
    );
    
    console.log(`City sequence: ${citySequence.join(' → ')}`);
    
    // Check for logical grouping (consecutive days in same city)
    let consecutiveGroups = [];
    let currentGroup = { city: citySequence[0], days: [1] };
    
    for (let i = 1; i < citySequence.length; i++) {
      if (citySequence[i] === currentGroup.city) {
        currentGroup.days.push(i + 1);
      } else {
        consecutiveGroups.push(currentGroup);
        currentGroup = { city: citySequence[i], days: [i + 1] };
      }
    }
    consecutiveGroups.push(currentGroup);
    
    console.log('Consecutive groups:');
    consecutiveGroups.forEach(group => {
      console.log(`  ${group.city}: Days ${group.days.join(', ')} (${group.days.length} consecutive days)`);
    });
    
    // Check if grouping is optimal (no scattered pattern)
    const isOptimal = consecutiveGroups.every(group => group.days.length >= 1);
    const hasScattering = consecutiveGroups.some((group, index) => {
      return consecutiveGroups.slice(index + 1).some(laterGroup => laterGroup.city === group.city);
    });
    
    if (!hasScattering) {
      console.log('✅ OPTIMAL: No city scattering detected - logical travel flow achieved!');
    } else {
      console.log('❌ SUBOPTIMAL: City scattering detected - same cities appear in non-consecutive days');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

// Test Case 2: Single city constraint validation
const testSingleCityConstraint = async () => {
  console.log('\n\n=== TEST CASE 2: Single City Constraint ===');
  
  const testData = {
    age: 30,
    budget: 4000,
    days: 2,
    interests: ['historical sites', 'museums'],
    cities: ['Cairo']
  };

  console.log('Test data:', testData);
  console.log('\n--- Testing Single Location Per Day Constraint ---\n');

  try {
    const result = await buildTripPlan(testData);
    
    console.log('\n--- SINGLE LOCATION CONSTRAINT RESULTS ---');
    if (!result.tripPlan || !result.tripPlan.days) {
      console.log('❌ ERROR: No trip plan or days found in result');
      return;
    }

    result.tripPlan.days.forEach((day, index) => {
      console.log(`\n📅 Day ${index + 1}:`);
      console.log(`  Sites: ${day.sites.map(s => `${s.name} (${s.city})`).join(', ')}`);
      
      if (day.restaurants.breakfast) {
        console.log(`  🌅 Breakfast: ${day.restaurants.breakfast.name} (${day.restaurants.breakfast.city})`);
      }
      if (day.restaurants.lunch) {
        console.log(`  🍽️ Lunch: ${day.restaurants.lunch.name} (${day.restaurants.lunch.city})`);
      }
      if (day.restaurants.dinner) {
        console.log(`  🌆 Dinner: ${day.restaurants.dinner.name} (${day.restaurants.dinner.city})`);
      }
      
      // Validate single location constraint
      const allLocations = [
        ...day.sites.map(s => s.city),
        day.restaurants.breakfast?.city,
        day.restaurants.lunch?.city,
        day.restaurants.dinner?.city
      ].filter(Boolean);
      
      const uniqueLocations = [...new Set(allLocations)];
      
      if (uniqueLocations.length === 1) {
        console.log(`  ✅ PERFECT: All activities in ${uniqueLocations[0]}`);
      } else {
        console.log(`  ❌ VIOLATION: Activities span multiple locations: ${uniqueLocations.join(', ')}`);
      }
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

// Run tests
const runTests = async () => {
  await testMultiCityFlow();
  await testSingleCityConstraint();
  
  console.log('\n🎯 Testing completed!');
  process.exit(0);
};

runTests().catch(console.error);
