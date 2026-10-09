# Pinyin cần review

Sinh tự động bởi `scripts/2-build-seed.mjs`. 13/1193 từ.

Sửa bằng cách thêm vào `data/overrides.pinyin.json`, rồi chạy lại `npm run data:build`.

| HSK | Hán tự | Đang chọn (pinyin-pro) | Nguồn A (forms) | Nguồn B | Cờ |
|---|---|---|---|---|---|
| 1 | 东西 | `dōng xi` | dōng xī, dōng xi | dōng xī, dōng xi | ambiguous_tone multi_reading |
| 1 | 多少 | `duō shao` | duō shǎo, duō shao | duō shǎo, duō shao | ambiguous_tone multi_reading |
| 2 | 告诉 | `gào su` | gào sù, gào su | gào sù, gào su | ambiguous_tone multi_reading |
| 2 | 好吃 | `hǎo chī` | hǎo chī, hào chī | hǎo chī, hào chī | ambiguous_tone multi_reading |
| 2 | 妻子 | `qī zi` | qī zǐ, qī zi | qī zǐ, qī zi | ambiguous_tone multi_reading |
| 2 | 着 | `zhe` | zhāo, zháo, zhe, zhuó | zhāo, zháo | conflict_sourceB multi_reading single_char_multi_sound |
| 3 | 地方 | `dì fang` | dì fāng, dì fang | dì fāng, dì fang | ambiguous_tone multi_reading |
| 3 | 故事 | `gù shi` | gù shì, gù shi | gù shì, gù shi | ambiguous_tone multi_reading |
| 3 | 过去 | `guò qu` | guò qù, guò qu | guò qù, guò qu | ambiguous_tone multi_reading |
| 4 | 当时 | `dāng shí` | dāng shí, dàng shí | dāng shí, dàng shí | ambiguous_tone multi_reading |
| 4 | 好处 | `hǎo chu` | hǎo chǔ, hǎo chu | hǎo chǔ, hǎo chu | ambiguous_tone multi_reading |
| 4 | 精神 | `jīng shen` | jīng shén, jīng shen | jīng shén, jīng shen | ambiguous_tone multi_reading |
| 4 | 起来 | `qǐ lai` | qǐ lai, qi lai | qǐ lai, qi lai | ambiguous_tone multi_reading |
