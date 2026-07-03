from load_data import load_data
from visualize import visualize

def main():
    # Load state
    filepath = 'data.json' # Ensure this matches your file

    # set dimensions
    width, height = 1400, 1000

    # Get the beats and edges
    import time
    start = time.perf_counter()
    beats, edges = load_data(filepath, height)
    print(time.perf_counter() - start)
    # # Visualize the data
    visualize(beats, edges, width, height)

if __name__ == "__main__":
    main()