import axios from 'axios';

const BASE_URL = 'http://localhost:5000/api/v1';

// We use the mock admin bypass token as defined in auth.middleware.ts
const ADMIN_HEADERS = {
  Authorization: 'Bearer mock-admin-token'
};

async function runTests() {
  console.log('--- STARTING ADMIN DASHBOARD E2E SMOKE TESTS ---');
  let passed = 0;
  let failed = 0;

  const testEndpoint = async (name: string, method: 'GET' | 'POST', endpoint: string, data?: any) => {
    console.log(`\nTesting [${name}] -> ${method} ${endpoint}`);
    try {
      const response = await axios({
        method,
        url: `${BASE_URL}${endpoint}`,
        headers: ADMIN_HEADERS,
        data,
      });

      if (response.data.success) {
        console.log(`✅ PASS: ${response.data.message || 'Success'}`);
        passed++;
      } else {
        console.error(`❌ FAIL: Expected success: true`);
        failed++;
      }
    } catch (error: any) {
      console.error(`❌ FAIL: Request crashed - ${error.response?.data?.message || error.message}`);
      failed++;
    }
  };

  // 1. Dashboard Statistics
  await testEndpoint('Fetch Dashboard Stats', 'GET', '/admin/stats');

  // 2. Fetch User Management List
  await testEndpoint('Fetch All Users', 'GET', '/admin/users');

  // 3. Fire AI Fraud Scan (Wait 2 seconds so it completes)
  await testEndpoint('Fire AI Fraud Heuristics Scan', 'POST', '/safety/admin/scan-fraud');
  
  // 4. Fetch Moderation Reports Queue
  await testEndpoint('Fetch Fraud Reports Queue', 'GET', '/safety/admin/reports?status=pending');

  // 5. Fetch Revenue/Transaction Reports
  await testEndpoint('Fetch Analytics Reports', 'GET', '/payments/reports');

  // 6. Fetch Content Management List
  await testEndpoint('Fetch CMS Entries', 'GET', '/admin/content');

  // 7. Fetch Scheduled Push Campaigns
  await testEndpoint('Fetch Scheduled Campaigns', 'GET', '/notifications/admin/campaigns');

  console.log('\n--- TEST RESULTS ---');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests();
