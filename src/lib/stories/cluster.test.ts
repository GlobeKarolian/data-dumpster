import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clusterPosts, type ClusterablePost } from './cluster';

let counter = 0;
function post(text: string, company: string, hoursAgo: number): ClusterablePost {
  counter += 1;
  return {
    id: 'p' + counter,
    companyId: 'c-' + company,
    companyName: company,
    platform: 'instagram',
    postedAt: new Date(Date.now() - hoursAgo * 3_600_000),
    text,
    permalink: null,
    thumbnailUrl: null,
    engagementTotal: 100,
    views: 0,
    urls: [],
  };
}

describe('cluster-level merge', () => {
  it('folds one event told two ways into one story', () => {
    // The Dolly Parton shape: one camp quotes her, one camp writes the
    // obituary. Pairwise cosine between camps sits under threshold; the
    // cluster-level pass must bridge them.
    const quotes = [
      post('"Look at all I\'ve done in 80 years. I just feel like I\'m getting started." Dolly Parton reflected on her life', 'PEOPLE', 5),
      post('Dolly Parton said look at all I have done in 80 years, just getting started, months before', 'Variety', 5),
      post('In her final interview Dolly Parton reflected: look at all I have done in 80 years', 'TODAY', 4),
    ];
    const obits = [
      post('BREAKING: Dolly Parton, country music legend and cultural icon, has died. She was 80.', 'BBC News', 6),
      post('Dolly Parton has died aged 80, the country music icon\'s death announced by her family', 'Fox News', 6),
      post('Dolly Parton, the country singer, songwriter and entertainer, dead at 80', 'The New York Times', 5),
    ];
    const unrelated = [
      post('A man dressed as the Cat in the Hat is roaming Boston streets after dark, videos show', 'CNN', 6),
      post('Videos show person in Cat in the Hat costume roaming streets after dark in Boston', 'NBC News', 5),
    ];
    // Background corpus: idf only makes an entity rare when most documents
    // are about something else, which is what a real day looks like.
    const background = [
      'City council votes to extend outdoor dining permits through the fall season',
      'New commuter rail schedule takes effect Monday with added weekend service',
      'Local bakery wins national award for its sourdough after twenty years',
      'Storm brings coastal flooding to the North Shore during high tide',
      'School committee debates new start times for high school students',
      'Housing lottery opens for new affordable units in the Seaport district',
      'Traffic on the expressway snarled for hours after a jackknifed trailer',
      'Farmers market season opens with record vendor signups this weekend',
      'Public library announces late fines are gone for good starting today',
      'Marathon route changes announced ahead of next spring\'s race',
      'Aquarium welcomes a rescued sea turtle recovering from cold stunning',
      'Bridge repairs will close one lane in each direction through October',
      'Restaurant week returns with more than two hundred participants',
      'Universities report record application numbers for the fall term',
      'Ferry service adds a late night run for summer weekend crowds',
      'Neighborhood group plants three hundred trees along the greenway',
    ].map((text, index) => post(text, 'Filler ' + index, 3 + (index % 5)));

    const clusters = clusterPosts(
      [...quotes, ...obits, ...unrelated, ...background],
      { minSize: 2 },
    );
    const dolly = clusters.filter((c) => c.keywords.some((k) => k.includes('dolly') || k.includes('parton')));
    assert.equal(dolly.length, 1, 'both Dolly camps must fold into one story');
    // Five or six: an outlier caption may pair with neither camp and drop as
    // noise, which is the accepted cost of keeping singletons out of merging.
    assert.ok(dolly[0].posts.length >= 5, 'both camps’ posts must be in the fold');
    const cat = clusters.filter((c) => c.keywords.some((k) => k.includes('cat') || k.includes('hat')));
    assert.equal(cat.length, 1, 'the unrelated story must survive as its own cluster');
    assert.equal(cat[0].posts.length, 2);
  });

  it('does not fold two different stories sharing one entity', () => {
    const gameStory = [
      post('Celtics beat the Lakers 112-104 behind a big fourth quarter from Tatum', 'NBC News', 6),
      post('Tatum leads Celtics past Lakers 112-104 with dominant fourth quarter', 'CBS Boston', 6),
    ];
    const tradeStory = [
      post('Celtics exploring trade options for backup center before the deadline, sources say', 'The Boston Globe', 5),
      post('Sources: Celtics working the phones on a backup center trade before the deadline', 'MassLive', 5),
    ];
    const clusters = clusterPosts([...gameStory, ...tradeStory], { minSize: 2 });
    assert.equal(clusters.length, 2, 'one shared entity is not one story');
  });
});
