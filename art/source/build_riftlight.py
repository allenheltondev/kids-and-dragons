"""Compatibility entry point for the painted rift frame packager.

The previous vector-path builder has been replaced by illustrated art. Keep
this command working so an old workflow cannot silently restore the old art.
"""
from pathlib import Path
import runpy

if __name__ == '__main__':
    runpy.run_path(str(Path(__file__).parent / 'painted-rifts/build.py'), run_name='__main__')
