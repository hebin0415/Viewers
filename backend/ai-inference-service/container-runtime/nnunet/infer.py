from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from common import run_family_adapter


if __name__ == '__main__':
    raise SystemExit(run_family_adapter('nnunet'))
