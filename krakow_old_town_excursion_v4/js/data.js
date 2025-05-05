const stops = [
  {
    title: "Главная рыночная площадь",
    description: "Центральная площадь Старого города, окружённая историческими зданиями и торговыми рядами.",
    audio: "audio/001_rynek_glowny.mp3",
    image: "images/001_rynek_glowny.jpg",
    lat: 50.0615174,
    lon: 19.9371069
  },
  {
    title: "Площадь Марьяцкая",
    description: "Площадь перед базиликой Богоматери, место сбора и торжественных событий.",
    audio: "audio/002_plac_mariacki.mp3",
    image: "images/002_plac_mariacki.jpg",
    lat: 50.0616771,
    lon: 19.9395229
  },
  {
    title: "Суконные ряды",
    description: "Суконные ряды, символ торговли и богатства средневекового Кракова.",
    audio: "audio/003_sukiennice.mp3",
    image: "images/003_sukiennice.jpg",
    lat: 50.0616922,
    lon: 19.9373488
  },
  {
    title: "Ратушная башня",
    description: "Остатки ратушной башни, откуда открывается вид на площадь.",
    audio: "audio/004_wieza_ratuszowa.mp3",
    image: "images/004_wieza_ratuszowa.jpg",
    lat: 50.0614858,
    lon: 19.9364149
  },
  {
    title: "Церковь св. Адальберта",
    description: "Одна из старейших церквей города, памятник романской архитектуры.",
    audio: "audio/005_kosciol_sw_wojciecha.mp3",
    image: "images/005_kosciol_sw_wojciecha.jpg",
    lat: 50.0606312,
    lon: 19.9380044
  },
  {
    title: "Памятник А. Мицкевичу",
    description: "Памятник великому поэту и национальному герою Адаму Мицкевичу.",
    audio: "audio/006_pomnik_mickiewicza.mp3",
    image: "images/006_pomnik_mickiewicza.jpg",
    lat: 50.0615174,
    lon: 19.9371069
  },
  {
    title: "Церковь св. Петра и Павла",
    description: "Барочный храм, посвящённый святым Петру и Павлу.",
    audio: "audio/007_kosciol_sw_piotra_pawla.mp3",
    image: "images/007_kosciol_sw_piotra_pawla.jpg",
    lat: 50.0573317,
    lon: 19.9390982
  },
  {
    title: "Флорианские ворота",
    description: "Главные городские ворота в средневековых стенах.",
    audio: "audio/008_bramaflorianska.mp3",
    image: "images/008_bramaflorianska.jpg",
    lat: 50.0621879,
    lon: 19.9394607
  },
  {
    title: "Граница еврейского квартала",
    description: "Мемориальная табличка, отмечающая границу бывшего еврейского квартала перед его переносом в Казимеж.",
    audio: "audio/009_ghetto_boundary.mp3",
    image: "images/009_ghetto_boundary.jpg",
    lat: 50.0621882,
    lon: 19.9395855
  },
  {
    title: "Барбакан",
    description: "Фрагмент оборонительных сооружений с видом на город.",
    audio: "audio/010_barbakan.mp3",
    image: "images/010_barbakan.jpg",
    lat: 50.066199,
    lon: 19.9402989
  },
  {
    title: "Улица Флорианская",
    description: "Одна из самых оживлённых торговых улиц Старого города.",
    audio: "audio/011_ulica_florianska.mp3",
    image: "images/011_ulica_florianska.jpg",
    lat: 50.0634113,
    lon: 19.9402619
  },
  {
    title: "Улица Гродская",
    description: "Древняя дорога к Вавелю, соединяющая Рыночную площадь с холмом.",
    audio: "audio/012_ulica_grodzka.mp3",
    image: "images/012_ulica_grodzka.jpg",
    lat: 50.0586377,
    lon: 19.9379245
  },
  {
    title: "Улица Канонича",
    description: "Старейшая улица с домами каноников и дворцами епископов.",
    audio: "audio/013_ulica_kanonicza.mp3",
    image: "images/013_ulica_kanonicza.jpg",
    lat: 50.0562354,
    lon: 19.9373927
  },
  {
    title: "Дом Яна Матейко",
    description: "Дом-музей выдающегося художника Яна Матейко.",
    audio: "audio/014_dom_jana_matejki.mp3",
    image: "images/014_dom_jana_matejki.jpg",
    lat: 50.063835,
    lon: 19.9410011
  },
  {
    title: "Collegium Maius",
    description: "Самое старое здание Ягеллонского университета, ныне музей.",
    audio: "audio/015_collegium_maius.mp3",
    image: "images/015_collegium_maius.jpg",
    lat: 50.0615762,
    lon: 19.9340136
  },
  {
    title: "Площадь Всех Святых",
    description: "Площадь с сохранившимися фрагментами городской стены и ворот.",
    audio: "audio/016_plac_wszystkich_swietych.mp3",
    image: "images/016_plac_wszystkich_swietych.jpg",
    lat: 50.0591347,
    lon: 19.9373846
  },
  {
    title: "Епископский дворец",
    description: "Официальная резиденция краковских епископов со средневековыми интерьерами.",
    audio: "audio/017_palac_biskupi.mp3",
    image: "images/017_palac_biskupi.jpg",
    lat: 50.0560694,
    lon: 19.9371005
  },
  {
    title: "Улица Славковская",
    description: "Улица, названная в честь старинного села Славков, с историческими каменицами.",
    audio: "audio/018_ulica_slawkowska.mp3",
    image: "images/018_ulica_slawkowska.jpg",
    lat: 50.0639333,
    lon: 19.9377551
  },
  {
    title: "Дом «Под Золотым Солнцем»",
    description: "Жилая каменица «Под Золотым Солнцем» XIV века.",
    audio: "audio/019_pod_zlotym_sloncem.mp3",
    image: "images/019_pod_zlotym_sloncem.jpg",
    lat: 50.0631458,
    lon: 19.9373115
  },
  {
    title: "Церковь св. Франциска Ассизского",
    description: "Готическая церковь францисканцев с древними фресками.",
    audio: "audio/020_kosciol_sw_franciszka.mp3",
    image: "images/020_kosciol_sw_franciszka.jpg",
    lat: 50.0598334,
    lon: 19.9346424
  },
  {
    title: "Дворец Кшиштофори",
    description: "Здание Krzysztofory, ныне исторический музей города.",
    audio: "audio/021_palac_krzysztofory.mp3",
    image: "images/021_palac_krzysztofory.jpg",
    lat: 50.0628889,
    lon: 19.936369
  },
  {
    title: "Улица Столярская",
    description: "Узкая улица ремесленников, соединяющая площадь с парком Planty.",
    audio: "audio/022_ulica_stolarska.mp3",
    image: "images/022_ulica_stolarska.jpg",
    lat: 50.0601403,
    lon: 19.9391177
  },
  {
    title: "Collegium Novum",
    description: "Новое здание университета в неоготическом стиле XIX века.",
    audio: "audio/023_collegium_novum.mp3",
    image: "images/023_collegium_novum.jpg",
    lat: 50.0608642,
    lon: 19.9332351
  },
  {
    title: "Музей Чарторыйских",
    description: "Музей князей Чарторыйских с богатой коллекцией шедевров искусства.",
    audio: "audio/024_muzeum_czartoryskich.mp3",
    image: "images/024_muzeum_czartoryskich.jpg",
    lat: 50.0647028,
    lon: 19.9398605
  },
  {
    title: "Дом «Под Орлом»",
    description: "Дом «Под Орлом» XVII века с архитектурными элементами барокко.",
    audio: "audio/025_pod_orlem.mp3",
    image: "images/025_pod_orlem.jpg",
    lat: 50.0587606,
    lon: 19.9376846
  },
  {
    title: "Улица Шпитальная",
    description: "Улица, ведущая к бывшему госпиталю св. Духа, ныне галерея.",
    audio: "audio/026_ulica_szpitalna.mp3",
    image: "images/026_ulica_szpitalna.jpg",
    lat: 50.0647876,
    lon: 19.942688
  },
  {
    title: "Дворец Шолайских",
    description: "Неоренессансный дворец Шолайских XIX века.",
    audio: "audio/027_palac_szolayskich.mp3",
    image: "images/027_palac_szolayskich.jpg",
    lat: 50.0630874,
    lon: 19.9361539
  },
  {
    title: "Дворец «Под Бараньими Рогами»",
    description: "Каменный дворец «Под Бараньими Рогами» XVI века.",
    audio: "audio/028_palac_pod_baranami.mp3",
    image: "images/028_palac_pod_baranami.jpg",
    lat: 50.0616022,
    lon: 19.9353977
  },
  {
    title: "Дворец Дзялынских",
    description: "Дворец рода Дзялынских в стиле барокко.",
    audio: "audio/029_palac_dzialynskich.mp3",
    image: "images/029_palac_dzialynskich.jpg",
    lat: 50.0589286,
    lon: 19.9367769
  },
  {
    title: "Археологический музей",
    description: "Археологический музей с коллекциями древностей региона.",
    audio: "audio/030_muzeum_archeologiczne.mp3",
    image: "images/030_muzeum_archeologiczne.jpg",
    lat: 50.0556035,
    lon: 19.9367045
  },
  {
    title: "Улица Баштова",
    description: "Улица, повторяющая линию старых городских стен.",
    audio: "audio/031_ulica_basztowa.mp3",
    image: "images/031_ulica_basztowa.jpg",
    lat: 50.066199,
    lon: 19.9402989
  },
];
