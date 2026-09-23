import os
import xml.etree.ElementTree as ET
from PIL import Image

def test_favicon_svg():
    path = "images/favicon.svg"
    assert os.path.exists(path), f"{path} does not exist"
    tree = ET.parse(path)
    root = tree.getroot()
    # Check that it contains Webify W colors (#0D63F1 or #222EE4 or #43B8DB)
    content = open(path).read()
    assert "#0D63F1" in content or "#222EE4" in content or "#43B8DB" in content, "favicon.svg missing Webify brand colors"
    assert "xlink:href=\"data:image/png" not in content, "favicon.svg should be vector, not embedded old raster image"

def test_png_icons():
    for rel_path, expected_size in [
        ("images/favicon-96x96.png", (96, 96)),
        ("images/apple-touch-icon.png", (180, 180)),
        ("images/favicon.png", (32, 32)),
    ]:
        assert os.path.exists(rel_path), f"{rel_path} does not exist"
        im = Image.open(rel_path)
        assert im.size == expected_size, f"{rel_path} expected {expected_size}, got {im.size}"

def test_ico_exists_and_valid():
    path = "images/favicon.ico"
    assert os.path.exists(path), f"{path} does not exist"
    im = Image.open(path)
    assert im.format == "ICO", f"{path} is not ICO format"

if __name__ == "__main__":
    test_favicon_svg()
    test_png_icons()
    test_ico_exists_and_valid()
    print("ALL TESTS PASSED")
