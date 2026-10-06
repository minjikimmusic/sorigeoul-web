# 여기에 음원 파일을 넣으세요

프로그램이 실제로 쓰는 파일 (네 곡 모두 이미 들어 있습니다)
  {song}_expert.wav        : 주고받기·비교용으로 잘라낸 선생님(전문가) 가창
  {song}_student_demo.wav  : 같은 구간의 학습자 가창 ('예시 비교 보기'용)
  {song}_expert_full.wav   : 자르지 않은 선생님 가창 전체 ('선생님 노래 듣기'용)
  jangdan_{장단}.wav        : '장단 듣기'·반주용 장단 음원
                             지금 semachi, jungjungmori 가 있고 gutgeori 는 없습니다
                             (없는 장단은 합성 장구 소리로 대신합니다)
  song = arirang | jindo | kwaejina | geumdaraekkung

넣으면 버튼이 자동으로 나타나는 파일 (지금은 없음)
  {song}_intro.mp3  : 곡 소개 안내 음성 (준비 화면 진입 시 자동 재생)

가창 슬라이스({song}_expert.wav / {song}_student_demo.wav)는
  손으로 만들지 말고 반드시 아래로 만들 것.
  (config 의 start_jangdan / jangdan_count / audio_preroll_s / 템포를 그대로 따라야
   곡선과 격자가 맞는다. 곡별 템포 덮어쓰기까지 적용된 값을 쓴다.)
    uv run python tools/build_audio_slice.py --song jindo --role expert --wav source/...원본.wav

장단 음원(jangdan_{장단}.wav)은 아래로 만들 것.
    uv run python tools/build_jangdan_loop.py --jangdan jungjungmori --wav ~/....wav

mp3 로 만들지 말 것 — 인코더가 앞뒤에 수십 ms 패딩을 붙여 장단 격자가 밀립니다.
원본(source/)은 건드리지 않는다.
