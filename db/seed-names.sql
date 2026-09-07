-- ═══════════════════════════════════════════════════════════════════
--  SIMALYTICS – skutečné názvy, kategorie a ikony komodit
--
--  ID = resource id ze SimCompanies (ověřeno proti encyklopedii
--  a market API: ID 1 = Power, ID 3 = Apples, ID 68 = Gold ore…).
--  Ikony = veřejný CDN s obrázky hry.
--
--  Idempotentní: existující ID se updatují, nová se vloží.
--  Spuštění: npm run db:schema:names  (nebo ručně v SQL editoru)
-- ═══════════════════════════════════════════════════════════════════

insert into public.items (id, name, category, image_url) values
  -- Energie
  (1,   'Power',                'Energie',              'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/power.png'),
  (2,   'Water',                'Energie',              'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/water.png'),
  (11,  'Petrol',               'Energie',              'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/petrol.png'),
  (12,  'Diesel',               'Energie',              'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/diesel.png'),
  -- Zemědělství a jídlo
  (3,   'Apples',               'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/apples.png'),
  (4,   'Oranges',              'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/oranges.png'),
  (5,   'Grapes',               'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/grapes.png'),
  (6,   'Grain',                'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/grain.png'),
  (7,   'Steak',                'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/steak.png'),
  (8,   'Sausages',             'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/sausages.png'),
  (9,   'Eggs',                 'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/eggs.png'),
  (40,  'Cotton',               'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/cotton.png'),
  (66,  'Seeds',                'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/seeds.png'),
  (115, 'Cows',                 'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/cow.png'),
  (116, 'Pigs',                 'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/pig.png'),
  (117, 'Milk',                 'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/milk.png'),
  (118, 'Coffee beans',         'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/coffee-beans.png'),
  (120, 'Vegetables',           'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/vegetables.png'),
  (136, 'Cocoa beans',          'Zemědělství a jídlo',  'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/cocoa-beans.png'),
  -- Suroviny
  (10,  'Crude oil',            'Suroviny',             'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/crude-oil.png'),
  (14,  'Minerals',             'Suroviny',             'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/minerals.png'),
  (15,  'Bauxite',              'Suroviny',             'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/bauxite.png'),
  (42,  'Iron ore',             'Suroviny',             'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/iron-ore.png'),
  (68,  'Gold ore',             'Suroviny',             'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/gold-ore.png'),
  -- Meziprodukty
  (16,  'Silicon',              'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/silicon.png'),
  (17,  'Chemicals',            'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/chemicals.png'),
  (18,  'Aluminium',            'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/aluminium.png'),
  (19,  'Plastic',              'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/plastic.png'),
  (41,  'Fabric',               'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/fabric.png'),
  (43,  'Steel',                'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/steel.png'),
  (46,  'Leather',              'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/leather.png'),
  (69,  'Gold bars',            'Meziprodukty',         'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/golden-bars.png'),
  -- Elektronika
  (20,  'Processors',           'Elektronika',          'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/processors.png'),
  (21,  'Electronic components','Elektronika',          'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/electronic-components.png'),
  (22,  'Batteries',            'Elektronika',          'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/batteries.png'),
  (23,  'Displays',             'Elektronika',          'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/displays.png'),
  -- Služby
  (13,  'Transport',            'Služby',               'https://jaqghnolagdxclnbcxem.supabase.co/storage/v1/object/public/edificios/recursos/transport.png')
on conflict (id) do update set
  name      = excluded.name,
  category  = excluded.category,
  image_url = excluded.image_url;
