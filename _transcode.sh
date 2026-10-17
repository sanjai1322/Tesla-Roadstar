set -e
cd "/c/Users/MY PC/Downloads/TESLA ROADSTAR"
O=site/public/video
# reveal film (with audio)
ffmpeg -v error -y -i TWMate.com-9a178c7f6ea955512c376e2940619263.mp4 -vf "scale=1920:-2" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart $O/film.mp4
# aero modes (no audio)
ffmpeg -v error -y -i TWMate.com-0a8f1b68464e15b966ba853508a9efa3.mp4 -vf "scale=1920:-2" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -an -movflags +faststart $O/aero.mp4
# loop stunt
ffmpeg -v error -y -i TWMate.com-9e2a1f0d8dd19976eec121d7930d3828.mp4 -vf "scale=1920:-2" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart $O/loop.mp4
# short muted ambient loop for hero-film teaser (wind tunnel opening 0-14s)
ffmpeg -v error -y -ss 0 -t 14 -i TWMate.com-9a178c7f6ea955512c376e2940619263.mp4 -vf "scale=1280:-2" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -an -movflags +faststart $O/film-teaser.mp4
# posters
for v in film aero loop; do ffmpeg -v error -y -ss 3 -i $O/$v.mp4 -frames:v 1 -vf scale=1600:-2 -q:v 4 site/public/img/poster-$v.jpg; done
echo DONE
ls -la $O
