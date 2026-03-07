// Simple fetch test
fetch('http://localhost:3001/api/papers?limit=3')
  .then(r => r.json())
  .then(data => {
    console.log('Papers received:', data.length);
    data.forEach((p, i) => {
      console.log(`\n${i+1}. ${p.title}`);
      console.log(`   Upvotes: ${p.upvotes || 'undefined'}`);
      console.log(`   ID: ${p.id}`);
    });
  })
  .catch(err => console.error('Error:', err));
