from load_data import load_data
from visualize import visualize

def main():
    # Load state
    filepath = 'data1.json' # Ensure this matches your file

    # set dimensions
    width, height = 1400, 800

    # Get the beats and edges
    beats, edges = load_data(filepath, height)

    # # Visualize the data
    visualize(beats, edges, width, height)

if __name__ == "__main__":
    main()