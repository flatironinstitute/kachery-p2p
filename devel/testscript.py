import neuropixels_data_sep_2020 as nd
import spikeextractors as se
from time import perf_counter


start = perf_counter()
try:
    # Replace this with the desired recording ID from above
    recording_id = 'cortexlab-single-phase-3 (ch 0-7, 10 sec)'

    # Note: if the files are not already on your, then you need
    # to run a kachery-p2p daemon on the flatiron1 channel.
    recording = nd.load_recording(recording_id)

    # recording is a SpikeInterface recording extractor
    # so you can extract information
    samplerate = recording.get_sampling_frequency()
    num_frames = recording.get_num_frames()
    num_channels = len(recording.get_channel_ids())
    channel_locations = recording.get_channel_locations()

    print(f'Num. channels: {num_channels}')
    print(f'Duration: {num_frames / samplerate} sec')

    # You can also extract the raw traces.
    # This will only download the part of the raw file needed
    traces = recording.get_traces(channel_ids=[0, 1, 2, 3], start_frame=0, end_frame=5000)
    print(f'Shape of extracted traces: {traces.shape}')

    # Or equivalently (using SubRecordingExtractor):
    recording_sub = se.SubRecordingExtractor(
        parent_recording=recording,
        channel_ids=[0, 1, 2, 3],
        start_frame=0, end_frame=5000
    )
    traces2 = recording_sub.get_traces()
    print(f'Shape of extracted traces: {traces2.shape}')
except Exception as error:
    print(error)
    raise error
finally:
    print(f"Elapsed time: {perf_counter() - start}")

