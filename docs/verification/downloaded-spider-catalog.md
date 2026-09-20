# Downloaded Spider-Man GLB catalog

Generated from a recursive scan of `~/Downloads`, `~/Desktop`, and `~/Documents`. The scan found **44 files / 40 unique hashes**. “Compatible” means the asset survived canonical bone mapping, all 63 traversal/dance clips, 806 temporal samples, finite skinned-vertex checks, and the silhouette expansion gate. Filename copies with identical hashes are grouped together.

## Already in the original nine-character lineup

| Identified suit | Downloaded file(s) | Animation compatible | Result |
|---|---|---:|---|
| The Amazing Spider-Man | `amazing_spider_man_2_rigged.glb` | Yes | Existing character |
| Across the Spider-Verse Miles Morales | `miles_morales_spiderman_rigged (1).glb`, `miles_morales_spiderman_rigged.glb` | Yes | Existing character; files are exact duplicates |
| No Way Home integrated suit | `spiderman_no_way_home_rigged (2).glb` | Yes | Existing character |
| Spider-Man (2002) / Raimi suit | `tobey_maguire_spider-_man_suit_rigged__animated (1).glb`, unsuffixed copy | Yes | Existing character; files are exact duplicates |
| Spider-Man 3 symbiote suit | `symbiote_spiderman_-_tobey_maguire.glb` | Yes after canonical repair | Removed from the game and replaced by the Spider-Man 2 Symbiote Suit |
| Into the Spider-Verse Miles Morales | `spiderman_-_miles_morales.glb` | Yes | Existing character |
| Homecoming motion-capture suit | `spiderman_motion_capture__perception_neuron.glb` | Yes | Replaced in the selector by the Homecoming Tech Suit |
| Alt Homecoming / classic red-and-blue suit | `spiderman.glb` | Yes | Existing character |
| Across the Spider-Verse Spider-Man 2099 | `spiderman_2099_spiderman_across_the_spider_verse.glb` | Yes | Existing character |

## Newly accepted and added

| Identified suit | Downloaded file | Animation compatible | Result |
|---|---|---:|---|
| Homecoming Tech Suit | `spider-man_2017_homecoming_-_tech_suit.glb` | Yes, Mixamo | Added as `homecoming-tech`, replacing the previous Homecoming selector entry; decimated 22.5% |
| Marvel’s Spider-Man 2 Symbiote Suit | `spider-man_2_symbiote_suit_ps5.glb` | Yes, Mixamo | Added as `symbiote-ps5` in the former Spider-Man 3 slot; decimated 52.0% |
| Pavitr Prabhakar | `spider-man_pavitr_prabhakar.glb` | Yes, Mixamo | Added as `pavitr-prabhakar` |
| Spider-Woman | `spider_woman_rigged (1).glb` | Yes after rest-frame/twist-helper repair | Added as `spider-woman-atsv` |
| Classic Spider-Man | `spiderman_classic_textured_rigged.glb` | Yes, Mixamo | Added as `classic-suit` |

## Audited but not added as separate characters

| Identified asset | Downloaded file(s) | Animation compatible | Decision |
|---|---|---:|---|
| Ultimate Alliance Spider-Man | `09_spider-man_mua.glb` | No | Isolated clips remain finite, but integrated wall crawl either tilts the torso or leaves the soles 20–35 cm off the facade |
| MCU Iron Spider | `iron_spidermantexturedrigged.glb` | No | Locomotion retargets, but every tested crawl source tilts the torso roughly 31° sideways on a facade |
| Advanced Suit 2.0 | `spider-man_2_advanced_suit_2.0.glb` | Yes, but excluded | Removed after repeatable building and ground contact hitches during play |
| Marvel’s Spider-Man Advanced Suit | `spider_man_playstation_rigged (1).glb` | Yes, but excluded | Removed after repeatable building and ground contact hitches during play |
| Symbiote Advanced Suit | `spiderman_venom_playstion_ps5.glb` | Yes, but excluded | Removed after repeatable building and ground contact hitches during play |
| The Amazing Spider-Man 2 (2014) | `spider-man_2014_the_amazing_spider-man_2.glb` | No | All 63 clips remain finite, but integrated wall crawl leaves the soles about 18 cm off the facade; the untouched original fails identically to the decimated trial |
| Venom | `the_venom_spiderman_2_playstation.glb` | No | All 63 clips remain finite, but integrated wall crawl leaves the soles about 30 cm off the facade |
| Classic Spider-Man / Iron Spider variant | `rigged_spider-man_3d_model__free_download.glb` | No | Missing arm, forearm, hand, leg, foot, and neck roles |
| Scarlet Spider (Across the Spider-Verse) | `scarlet_spider_across_the_spider_verse.glb` | No | Deformation bones are disconnected from the humanoid controls; full-pack sampling inverted limbs |
| Classic Spider-Man 2099 | `miguel_ohara_spiderman_2099_rigged_textured.glb` | No | Skin stops rendering after the required canonical bone repair |
| Spider-Man 2099 (Future Fight) | `spider-man_2099_marvel_future_fight_heroes.glb` | No | Unsupported twist chains detach head, hands, and torso sections in traversal poses |
| Symbiote Suit alternate export | `spider-man_2_symbiote_suit_ps5 (1).glb` | Yes | Same suit/model as the accepted smaller export; omitted as a duplicate selector entry |
| Symbiote Suit Blender export | `spider-man_symbiote_spider-man_2_ps5_blend.glb` | Partial | Same suit design as the accepted verified export; omitted as a duplicate |
| “Webb” Spider-Man | `spider-man_webb_rigged.glb` | No | Incomplete/malformed humanoid hierarchy |
| Advanced Suit alternate export | `spider_man_playstation_rigged.glb` | Yes | Same suit as the accepted smaller export |
| City Night Spider-Man scene | `spiderman_city_night.glb` | N/A | Whole environment scene, not a standalone character asset |
| Advanced Suit flip carrier | `spiderman_flip.glb` | Yes | Duplicate Advanced Suit geometry carrying one animation; the animation library already covers flips |
| Miles Morales static model | `spiderman_miles_morales.glb` | No | No skeleton or skinned meshes |
| No Way Home alternate export | `spiderman_no_way_home_rigged.glb` | Yes | Same suit as the active smaller export |
| Raimi/Webbed suit custom rig | `spiderman_original.glb` | No | Missing neck, forearm, and hand roles; duplicates the active Raimi suit design |
| PlayStation Advanced Suit alternate | `spiderman_ps4_rigged.glb` | Yes | Same suit design as the accepted `playstation` model |
| Classic traversal-library Spider-Man | `spiderman_rigged (1).glb`, `spiderman_rigged.glb` | Yes | Exact duplicate files and duplicate classic design; retained only as the shared legacy animation source |
| Authored Spider-Man web strand | `spiderman_web (1).glb`, `spiderman_web.glb` | N/A | Exact duplicate effect files; the downloaded mesh is now used for swing and surface-zip webs |
| Symbiote Suit alternate design export | `symbiote_suit_-_spider-man_2_ps5.glb` | Yes | Same Spider-Man 2 symbiote design as the accepted higher-quality source |
| Historical cleaned PS4 model | `Documents/Codex/2026-08-28/i-wa/work/ps4-clean.glb` | Yes | Same Advanced Suit design as the accepted downloaded model |
| Historical removed Webbed suit | `Documents/Codex/2026-08-28/i-wa/work/removed-webbed-suit/original.glb` | No | Missing neck, forearm, and hand roles; duplicate Raimi design |

The machine-readable scan is in `downloaded-spider-rigs.json`, accepted/rejected import details are in `discovered-suit-imports.json`, decimation measurements are in `decimated-suits.json`, and the full animation sampling results are in `character-lineup.json`.
