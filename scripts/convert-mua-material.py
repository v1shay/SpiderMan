import bpy
import pathlib
import sys


def cli_value(flag: str) -> pathlib.Path:
    args = sys.argv[sys.argv.index("--") + 1 :]
    return pathlib.Path(args[args.index(flag) + 1]).resolve()


source = cli_value("--input")
target = cli_value("--output")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source), import_pack_images=True)

# Blender's glTF importer resolves KHR_materials_pbrSpecularGlossiness into
# Principled BSDF nodes. Re-exporting writes browser-native glTF 2.0 PBR while
# preserving the armature, all NLA actions and embedded images.
bpy.ops.export_scene.gltf(
    filepath=str(target),
    export_format="GLB",
    export_image_format="AUTO",
    export_materials="EXPORT",
    export_animations=True,
    export_nla_strips=True,
    export_nla_strips_merged_animation_name="{action}",
    export_optimize_animation_size=False,
    export_optimize_animation_keep_anim_armature=True,
    export_optimize_animation_keep_anim_object=True,
    export_yup=True,
)

print(f"Converted {source} -> {target}")
