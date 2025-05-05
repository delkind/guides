const stops = [
  {
    title: "Музей Кракова — отдел Подгуж",
    description: "Филиал Музея Кракова, расположенный на центральной площади Подгужа.",
    audio: "audio/001_museum_podgorze.mp3",
    image: "images/001_museum_podgorze.jpg",
    lat: 50.0447401,
    lon: 19.9499381
  },
  {
    title: "Давний Подгужский ратушный дом",
    description: "Бывший ратушный дом района Подгуж, важный административный центр XIX века.",
    audio: "audio/002_old_town_hall.mp3",
    image: "images/002_old_town_hall.jpg",
    lat: 50.0440793,
    lon: 19.9484569
  },
  {
    title: "Костёл св. Иосифа",
    description: "Костёл св. Иосифа — архитектурный памятник в неоготическом стиле.",
    audio: "audio/003_st_joseph.mp3",
    image: "images/003_st_joseph.jpg",
    lat: 50.0439366,
    lon: 19.9508945
  },
  {
    title: "Кладбище Подгужского гетто",
    description: "Кладбище Подгужского гетто, место памяти жертв Холокоста.",
    audio: "audio/004_ghetto_cemetery.mp3",
    image: "images/004_ghetto_cemetery.jpg",
    lat: 50.0350174,
    lon: 19.9662552
  },
  {
    title: "Копец Кракуса",
    description: "Копец Кракуса — древний курган с панорамным видом на город.",
    audio: "audio/005_kopiec_krakusa.mp3",
    image: "images/005_kopiec_krakusa.jpg",
    lat: 50.0396932,
    lon: 19.9600668
  },
  {
    title: "Набережные Вислы",
    description: "Набережные Вислы — живописная пешеходная зона вдоль реки.",
    audio: "audio/006_vistula_boulevards.mp3",
    image: "images/006_vistula_boulevards.jpg",
    lat: 50.0478327,
    lon: 19.9544019
  },
  {
    title: "Мост отца Бернатка",
    description: "Пешеходный мост отца Бернатка, соединяющий Подгуж с Казимежем.",
    audio: "audio/007_father_bernatka_bridge.mp3",
    image: "images/007_father_bernatka_bridge.jpg",
    lat: 50.0493359,
    lon: 19.9531358
  },
  {
    title: "Культурный центр «Forum Przestrzenie»",
    description: "Forum Przestrzenie — культурный центр в бывшем бетонном складе.",
    audio: "audio/008_forum_przestrzenie.mp3",
    image: "images/008_forum_przestrzenie.jpg",
    lat: 50.0450326,
    lon: 19.9361576
  },
  {
    title: "Квест-комната «Exit Podgórze»",
    description: "Квест-комната «Exit Podgórze» в историческом здании.",
    audio: "audio/009_exit_room_podgorze.mp3",
    image: "images/009_exit_room_podgorze.jpg",
    lat: 50.045852,
    lon: 19.9500111
  },
  {
    title: "Музей фотографии MuFo",
    description: "Музей фотографии MuFo — главный музей фотографии в Польше.",
    audio: "audio/010_muzeum_fotografii_mufo.mp3",
    image: "images/010_muzeum_fotografii_mufo.jpg",
    lat: 50.0458104,
    lon: 19.9511314
  },
  {
    title: "Стрит-арт на Przemysłowa",
    description: "Стрит-арт на Przemysłowa — яркие муралы местных художников.",
    audio: "audio/011_street_art_przemyslowa.mp3",
    image: "images/011_street_art_przemyslowa.jpg",
    lat: 49.940149,
    lon: 19.8038783
  },
  {
    title: "Бывший еврейский госпиталь",
    description: "Бывший еврейский госпиталь — медицинское учреждение довоенной эпохи.",
    audio: "audio/012_jewish_hospital.mp3",
    image: "images/012_jewish_hospital.jpg",
    lat: 50.0457845,
    lon: 19.9515495
  },
  {
    title: "Аптека «Под Орлом»",
    description: "Аптека «Под Орлом» — памятник гражданской архитектуры XIX века.",
    audio: "audio/013_apteka_pod_orlem.mp3",
    image: "images/013_apteka_pod_orlem.jpg",
    lat: 50.045063,
    lon: 19.9545786
  },
  {
    title: "Площадь Героев Гетто",
    description: "Площадь Героев Гетто — центральная точка памяти о евреях Кракова.",
    audio: "audio/014_heroes_of_ghetto_square.mp3",
    image: "images/014_heroes_of_ghetto_square.jpg",
    lat: 50.045063,
    lon: 19.9545786
  },
  {
    title: "Фрагменты стены гетто",
    description: "Фрагменты стены гетто — сохранившиеся остатки баррикад и домов.",
    audio: "audio/015_ghetto_wall_fragments.mp3",
    image: "images/015_ghetto_wall_fragments.jpg",
    lat: 50.0446115,
    lon: 19.9570538
  },
  {
    title: "Памятник депортации (Umschlagplatz)",
    description: "Памятник депортации (Umschlagplatz) — место отправки узников.",
    audio: "audio/016_umschlagplatz_monument.mp3",
    image: "images/016_umschlagplatz_monument.jpg",
    lat: 50.0447097,
    lon: 19.9574029
  },
  {
    title: "Музей фабрики Шиндлера",
    description: "Музей фабрики Шиндлера — бывшая эмалированная фабрика O. Schindler.",
    audio: "audio/017_schindlers_factory.mp3",
    image: "images/017_schindlers_factory.jpg",
    lat: 50.0478769,
    lon: 19.9613687
  },
  {
    title: "Старый железнодорожный вокзал Подгужа",
    description: "Историческое здание железнодорожной станции, одна из старейших точек индустриального Подгужа.",
    audio: "audio/018_podgorze_station.mp3",
    image: "images/018_podgorze_station.jpg",
    lat: 50.0337969,
    lon: 19.9726262
  },
];
