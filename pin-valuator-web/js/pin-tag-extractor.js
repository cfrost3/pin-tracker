// pin-tag-extractor.js — browser port of the Swift PinTagExtractor.
// Scans free text (catalog page titles, best-guess labels) for known
// vocabulary terms and returns whichever ones appear.

const PinTagExtractor = (() => {
  const seedCharacters = [
    'Mickey Mouse', 'Minnie Mouse', 'Donald Duck', 'Daisy Duck', 'Goofy', 'Pluto',
    'Stitch', 'Lilo', 'Figment', 'Dreamfinder', 'Tinker Bell', 'Peter Pan',
    'Hercules', 'Megara', 'Madame Leota', 'Jack Skellington', 'Sally',
    'Elsa', 'Anna', 'Olaf', 'Ariel', 'Ursula', 'Belle', 'Beast', 'Aladdin',
    'Jasmine', 'Genie', 'Simba', 'Mufasa', 'Scar', 'Winnie the Pooh',
    'Eeyore', 'Tigger', 'Piglet', 'Mulan', 'Cinderella', 'Snow White',
    'Maleficent', 'Captain Jack Sparrow', 'Jack Sparrow', 'Baymax',
    'Moana', 'Maui', 'Judy Hopps', 'Nick Wilde', 'Yoda', 'Darth Vader',
    'Baby Groot', 'Spider-Man', 'Iron Man'
  ];
  const seedMovies = [
    'Lilo & Stitch', 'Hercules', 'The Little Mermaid', 'Beauty and the Beast',
    'Aladdin', 'The Lion King', 'Winnie the Pooh', 'Mulan', 'Cinderella',
    'Snow White and the Seven Dwarfs', 'Sleeping Beauty', 'Frozen',
    'Moana', 'Zootopia', 'Pirates of the Caribbean', 'Big Hero 6',
    'Star Wars', 'Marvel', 'Up', 'Coco', 'Encanto', 'Tangled',
    'The Nightmare Before Christmas', 'Peter Pan'
  ];
  const seedHolidays = ['Halloween', 'Christmas', 'Lunar New Year', "Valentine's Day", 'Easter', 'Thanksgiving', "New Year's Eve", '4th of July'];
  const seedParks = ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom', 'Disneyland', 'Disney California Adventure', 'Disneyland Paris', 'Tokyo Disneyland', 'Hong Kong Disneyland', 'Shanghai Disneyland'];
  const seedAttractions = ['Haunted Mansion', 'Space Mountain', 'Pirates of the Caribbean', 'Journey Into Imagination', 'Big Thunder Mountain', "It's a Small World", 'Jungle Cruise', 'Splash Mountain', 'Tower of Terror', "Soarin'", 'Guardians of the Galaxy', 'Rise of the Resistance', 'Matterhorn'];

  /// Builds the live vocabulary: seed lists plus every distinct value
  /// already present in the user's own items, so it grows smarter as the
  /// collection grows (including con-specific terms the seed list lacks).
  async function liveVocabulary() {
    const items = await DB.getAllItems();
    const characters = new Set(seedCharacters);
    const movies = new Set(seedMovies);
    const holidays = new Set(seedHolidays);
    const parks = new Set(seedParks);
    const attractions = new Set(seedAttractions);

    items.forEach(item => {
      (item.characters || []).forEach(c => characters.add(c));
      if (item.movie) movies.add(item.movie);
      if (item.holiday) holidays.add(item.holiday);
      if (item.park) parks.add(item.park);
      if (item.attraction) attractions.add(item.attraction);
    });

    return {
      characters: [...characters], movies: [...movies], holidays: [...holidays],
      parks: [...parks], attractions: [...attractions]
    };
  }

  function findFirst(terms, text) {
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    const lower = text.toLowerCase();
    return sorted.find(t => lower.includes(t.toLowerCase())) || null;
  }

  function findAll(terms, text) {
    const sorted = [...terms].sort((a, b) => b.length - a.length);
    const lower = text.toLowerCase();
    return sorted.filter(t => lower.includes(t.toLowerCase()));
  }

  function extractFromText(text, vocabulary) {
    return {
      characters: findAll(vocabulary.characters, text),
      movie: findFirst(vocabulary.movies, text),
      holiday: findFirst(vocabulary.holidays, text),
      park: findFirst(vocabulary.parks, text),
      attraction: findFirst(vocabulary.attractions, text)
    };
  }

  /// Union of hits across several text sources (e.g. every page title from
  /// a web search), since different pages may mention different details
  /// about the same item.
  function extractFromTexts(texts, vocabulary) {
    const combined = { characters: [], movie: null, holiday: null, park: null, attraction: null };
    texts.forEach(text => {
      const tags = extractFromText(text, vocabulary);
      combined.characters.push(...tags.characters);
      combined.movie = combined.movie || tags.movie;
      combined.holiday = combined.holiday || tags.holiday;
      combined.park = combined.park || tags.park;
      combined.attraction = combined.attraction || tags.attraction;
    });
    combined.characters = [...new Set(combined.characters)].sort();
    return combined;
  }

  return { liveVocabulary, extractFromText, extractFromTexts };
})();
